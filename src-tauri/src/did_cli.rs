use anyhow::{anyhow, Context, Result};
use bip39::{Language, Mnemonic};
use bitcoin::bip32::{DerivationPath, Fingerprint, Xpriv, Xpub};
use bitcoin::key::Secp256k1;
use bitcoin::{Address, CompressedPublicKey, Network, PubkeyHash};
use clap::{ArgGroup, Args, Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
// 加密相关依赖：PBKDF2 + AES-256-GCM
use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm, Nonce};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use std::fs;
use std::path::PathBuf;

// =========================
// 程序目标：
// 1) 创建 BTC + ETH 账户：生成助记词，要求输入密码，使用密码加密保存助记词。
// 2) 通过助记词导入 BTC + ETH 账户：同样要求密码，加密保存助记词。
// 3) 通过密码解密并导出助记词。
// 封装性：BTC/ETH 派生逻辑分别在不同结构体中。中文注释说明每步的作用。
// =========================

#[derive(Copy, Clone, Debug, Serialize, ValueEnum)]
enum AddrKind {
    // 传统地址（Legacy），BIP44，对应 p2pkh
    B44, // legacy p2pkh
    // 隔离见证兼容地址（Nested SegWit），BIP49，对应 p2sh-p2wpkh
    B49, // p2sh-p2wpkh
    // 原生隔离见证（Native SegWit），BIP84，对应 p2wpkh（bech32/bech32m）
    B84, // native segwit p2wpkh
    // Taproot（BIP86），对应 p2tr
    B86, // taproot p2tr
}

impl AddrKind {
    fn purpose(self) -> u32 {
        match self {
            AddrKind::B44 => 44,
            AddrKind::B49 => 49,
            AddrKind::B84 => 84,
            AddrKind::B86 => 86,
        }
    }
}

#[derive(Copy, Clone, Debug, Serialize, ValueEnum)]
// 网络参数：影响 BTC 地址前缀（mainnet=bc1…，testnet=tb1…）与 coin_type 默认值
enum NetArg {
    Mainnet,
    Testnet,
    Regtest,
    Signet,
}

impl From<NetArg> for Network {
    fn from(value: NetArg) -> Self {
        match value {
            NetArg::Mainnet => Network::Bitcoin,
            NetArg::Testnet => Network::Testnet,
            NetArg::Regtest => Network::Regtest,
            NetArg::Signet => Network::Signet,
        }
    }
}

// ============ 顶层 CLI ============
#[derive(Parser, Debug)]
#[command(name = "wallet-cli")]
#[command(about = "创建/导入 BTC+ETH 钱包（助记词加密存储），并可用密码导出助记词")]
#[command(author, version)]
struct Cli {
    /// 钱包文件路径（用于保存加密后的助记词等元数据）
    #[arg(long, default_value = "wallet.json")]
    wallet: PathBuf,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// 创建新钱包（生成助记词），并使用密码加密保存
    Create(CreateArgs),
    /// 导入已有助记词，并使用密码加密保存
    Import(ImportArgs),
    /// 使用密码解密并导出助记词
    ExportMnemonic(ExportArgs),
}

#[derive(Args, Debug)]
#[command(group(ArgGroup::new("entropy").args(["words", "strength"])))]
struct CreateArgs {
    /// 设置加密钱包的密码（用于加密/解密助记词）
    #[arg(long)]
    password: String,

    /// BTC 网络：mainnet / testnet / regtest / signet
    #[arg(long, value_enum, default_value = "mainnet")]
    network: NetArg,

    /// BTC 地址类型（BIP purpose）：b44/b49/b84/b86
    #[arg(long, value_enum, default_value = "b84")]
    kind: AddrKind,

    /// BIP44 coin_type（主网默认 0，测试网默认 1），可显式覆盖
    #[arg(long)]
    coin_type: Option<u32>,

    /// 账户索引（account'），默认 0
    #[arg(long, default_value_t = 0)]
    account: u32,

    /// 0=外部地址（收款），1=找零地址
    #[arg(long, default_value_t = 0)]
    change: u32,

    /// 地址索引
    #[arg(long, default_value_t = 0)]
    index: u32,

    /// 助记词语言（此处仅启用 english）
    #[arg(long, default_value = "english")]
    language: String,

    /// 指定助记词单词数（12/15/18/21/24），与 strength 二选一
    #[arg(long)]
    words: Option<usize>,

    /// 指定熵强度（128/160/192/224/256），与 words 二选一
    #[arg(long)]
    strength: Option<usize>,

    /// BIP39 口令（可选），用于加盐生成种子
    #[arg(long, default_value = "")]
    passphrase: String,

    /// 若钱包文件已存在，允许覆盖
    #[arg(long, default_value_t = false)]
    force: bool,
}

#[derive(Args, Debug)]
struct ImportArgs {
    /// 设置加密钱包的密码（用于加密/解密助记词）
    #[arg(long)]
    password: String,

    /// 导入的助记词（当前词表仅支持 english）
    #[arg(long)]
    mnemonic: String,

    /// BTC 网络：mainnet / testnet / regtest / signet
    #[arg(long, value_enum, default_value = "mainnet")]
    network: NetArg,

    /// BTC 地址类型（BIP purpose）：b44/b49/b84/b86
    #[arg(long, value_enum, default_value = "b84")]
    kind: AddrKind,

    /// BIP44 coin_type（主网默认 0，测试网默认 1），可显式覆盖
    #[arg(long)]
    coin_type: Option<u32>,

    /// 账户索引（account'），默认 0
    #[arg(long, default_value_t = 0)]
    account: u32,

    /// 0=外部地址（收款），1=找零地址
    #[arg(long, default_value_t = 0)]
    change: u32,

    /// 地址索引
    #[arg(long, default_value_t = 0)]
    index: u32,

    /// BIP39 口令（可选），用于加盐生成种子
    #[arg(long, default_value = "")]
    passphrase: String,
}

#[derive(Args, Debug)]
struct ExportArgs {
    /// 用于解密钱包的密码
    #[arg(long)]
    password: String,
}

#[derive(Serialize)]
// 统一输出：同时包含 BTC 与 ETH 的地址与关键元信息
struct WalletOut {
    network: String,      // 所选网络（仅影响 BTC）
    kind: String,         // BTC 地址族标识，例如 b84
    purpose: u32,         // purpose（44/49/84/86）
    path_account: String, // 账户级路径（BTC）：m/purpose'/coin_type'/account'
    path_addr: String,    // 地址级相对路径（BTC）：change/index
    account_xpub: String, // 账户扩展公钥（BTC），用于前端派生地址
    account_fpr: String,  // master xpub 的指纹，用于快速识别
    btc_address: String,  // BTC 地址（根据 kind 派生）
    eth_address: String,  // ETH 地址（EIP-55 格式，0x 开头）
    mnemonic: String,     // 使用/生成的助记词（仅在创建/导入时回显，不从文件解密后回显）
    #[serde(skip_serializing_if = "Option::is_none")]
    seed_hex: Option<String>, //（可选）种子 hex（敏感）
    #[serde(skip_serializing_if = "Option::is_none")]
    account_xprv: Option<String>, //（可选）账户扩展私钥（敏感）
}

fn address_path(change: u32, index: u32) -> DerivationPath {
    let path = format!("{}/{}", change, index);
    path.parse().expect("static path")
}

// ---------- 种子/主密钥上下文：多链共享 ----------
struct SeedCtx {
    network: Network,
    secp: Secp256k1<bitcoin::secp256k1::All>,
    seed_bytes: [u8; 64],
    master_xprv: Xpriv,
    master_xpub: Xpub,
    fpr: Fingerprint,
    mnemonic: Mnemonic,
}

impl SeedCtx {
    fn new(network: Network, mnemonic: Mnemonic, passphrase: &str) -> Result<Self> {
        // 通过助记词 + 口令 生成 64 字节种子
        let seed_bytes = mnemonic.to_seed(passphrase);
        let secp = Secp256k1::new();
        // 从种子生成 master 扩展私钥与扩展公钥
        let master_xprv = Xpriv::new_master(network, &seed_bytes)?;
        let master_xpub = Xpub::from_priv(&secp, &master_xprv);
        let fpr = master_xpub.fingerprint();
        Ok(Self {
            network,
            secp,
            seed_bytes,
            master_xprv,
            master_xpub,
            fpr,
            mnemonic,
        })
    }
}

// ---------- BTC 派生逻辑（封装在结构体内） ----------
struct BtcWallet {
    network: Network,
    kind: AddrKind,
    coin_type: u32,
}

impl BtcWallet {
    fn new(network: Network, kind: AddrKind, coin_type: u32) -> Self {
        Self {
            network,
            kind,
            coin_type,
        }
    }

    #[inline]
    fn purpose(&self) -> u32 {
        self.kind.purpose()
    }

    #[inline]
    fn kind_tag(&self) -> String {
        format!("b{}", self.purpose())
    }

    fn account_path(&self, account: u32) -> DerivationPath {
        // m / purpose' / coin_type' / account'
        let path = format!(
            "m/{}'/{}'/{}'",
            self.kind.purpose(),
            self.coin_type,
            account
        );
        path.parse().expect("static path")
    }

    fn derive_account(&self, ctx: &SeedCtx, account: u32) -> Result<(Xpriv, Xpub, DerivationPath)> {
        // 账户级别：m / purpose' / coin_type' / account'
        let acc_path = self.account_path(account);
        let acc_xprv = ctx.master_xprv.derive_priv(&ctx.secp, &acc_path)?;
        let acc_xpub = Xpub::from_priv(&ctx.secp, &acc_xprv);
        Ok((acc_xprv, acc_xpub, acc_path))
    }

    fn derive_address(
        &self,
        ctx: &SeedCtx,
        account_xprv: &Xpriv,
        change: u32,
        index: u32,
    ) -> Result<Address> {
        // 地址级别：change / index
        let addr_path = address_path(change, index);
        let child_prv = account_xprv.derive_priv(&ctx.secp, &addr_path)?;
        let child_pub = Xpub::from_priv(&ctx.secp, &child_prv);
        let secp_pk = child_pub.public_key;
        let cpk = CompressedPublicKey(secp_pk);
        let addr = match self.kind {
            AddrKind::B44 => {
                // 传统 p2pkh
                let pkh: PubkeyHash = PubkeyHash::from(&cpk);
                Address::p2pkh(pkh, self.network)
            }
            AddrKind::B49 => Address::p2shwpkh(&cpk, self.network),
            AddrKind::B84 => Address::p2wpkh(&cpk, self.network),
            AddrKind::B86 => {
                // Taproot p2tr
                let (xonly, _parity) = secp_pk.x_only_public_key();
                Address::p2tr(&ctx.secp, xonly, None, self.network)
            }
        };
        Ok(addr)
    }

    // 一步得到账户 xpub、账户路径以及指定 change/index 的 BTC 地址
    fn derive_account_and_address(
        &self,
        ctx: &SeedCtx,
        account: u32,
        change: u32,
        index: u32,
    ) -> Result<(Xpub, DerivationPath, Address)> {
        let (account_xprv, account_xpub, acc_path) = self.derive_account(ctx, account)?;
        let addr = self.derive_address(ctx, &account_xprv, change, index)?;
        Ok((account_xpub, acc_path, addr))
    }

    // BTC 专用：导出 master xpub 的指纹（hex），用于识别账户来源
    fn account_fpr_hex(&self, ctx: &SeedCtx) -> String {
        hex::encode(ctx.fpr.as_bytes())
    }
}

// ---------- ETH 派生逻辑（封装在结构体内） ----------
struct EthWallet;

impl EthWallet {
    // 与 BTC 一致：先构造实例再调用方法（此处无状态，仅为风格统一）
    fn new() -> Self {
        EthWallet
    }
    fn account_path(account: u32) -> DerivationPath {
        // m / 44' / 60' / account'
        let path = format!("m/44'/60'/{}'", account);
        path.parse().expect("static path")
    }

    fn to_eip55(addr20: &[u8; 20]) -> String {
        // EIP-55 校验大小写
        let lower_hex = hex::encode(addr20);
        let hash = Keccak256::digest(lower_hex.as_bytes());
        let mut out = String::with_capacity(42);
        out.push_str("0x");
        for (i, ch) in lower_hex.chars().enumerate() {
            let nibble = (hash[i / 2] >> (4 * (1 - (i % 2)))) & 0x0f;
            if ch.is_ascii_hexdigit() && ch.is_ascii_lowercase() && nibble > 7 {
                out.push(ch.to_ascii_uppercase());
            } else {
                out.push(ch);
            }
        }
        out
    }

    fn derive_address(
        &self,
        ctx: &SeedCtx,
        account: u32,
        change: u32,
        index: u32,
    ) -> Result<String> {
        // BIP44 路径：m / 44' / 60' / account' / change / index
        let acc_path = Self::account_path(account);
        let acc_xprv = ctx.master_xprv.derive_priv(&ctx.secp, &acc_path)?;
        let addr_xprv = acc_xprv.derive_priv(&ctx.secp, &address_path(change, index))?;
        let xpub = Xpub::from_priv(&ctx.secp, &addr_xprv);
        let secp_pk = xpub.public_key;
        // ETH 地址：对未压缩公钥（去掉 0x04 前缀）做 Keccak-256，取后 20 字节
        let uncompressed = secp_pk.serialize_uncompressed();
        let hash = Keccak256::digest(&uncompressed[1..]);
        let mut addr20 = [0u8; 20];
        addr20.copy_from_slice(&hash[12..]);
        Ok(Self::to_eip55(&addr20))
    }
}

// 将 CLI 语言字符串解析为 bip39::Language（此处仅支持 English）
fn parse_language(s: &str) -> Result<Language> {
    match s.to_ascii_lowercase().as_str() {
        "english" | "en" => Ok(Language::English),
        other => Err(anyhow!(format!(
            "Unsupported language: {} (only 'english' is enabled)",
            other
        ))),
    }
}

impl BtcWallet {
    // 根据网络决定 BIP44 coin_type：主网=0，其它=1；允许显式覆盖
    fn default_coin_type(network: Network, override_ct: Option<u32>) -> u32 {
        if let Some(ct) = override_ct {
            return ct;
        }
        match network {
            Network::Bitcoin => 0,
            _ => 1,
        }
    }
}

// ======== 简单的加密封装（PBKDF2 + AES-256-GCM） ========
#[derive(Serialize, Deserialize)]
struct WalletFile {
    version: u32,
    network: String,
    // KDF 参数
    kdf_iter: u32,
    kdf_salt_hex: String,
    // 对称加密：AES-256-GCM
    cipher_nonce_hex: String,
    cipher_hex: String,
}

fn kdf(password: &str, salt: &[u8], iter: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iter, &mut key);
    key
}

fn encrypt_mnemonic(password: &str, mnemonic: &Mnemonic) -> Result<WalletFile> {
    // 生成随机盐和随机 nonce
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);

    let iter = 100_000u32; // PBKDF2 迭代次数
    let key = kdf(password, &salt, iter);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("aes key");
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = mnemonic.to_string();
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow!("encrypt failed: {e}"))?;

    let wf = WalletFile {
        version: 1,
        network: String::new(), // 调用方填充
        kdf_iter: iter,
        kdf_salt_hex: hex::encode(salt),
        cipher_nonce_hex: hex::encode(nonce_bytes),
        cipher_hex: hex::encode(ciphertext),
    };
    Ok(wf)
}

fn decrypt_mnemonic(password: &str, wf: &WalletFile) -> Result<String> {
    let salt = hex::decode(&wf.kdf_salt_hex).context("bad salt hex")?;
    let nonce_bytes = hex::decode(&wf.cipher_nonce_hex).context("bad nonce hex")?;
    let ciphertext = hex::decode(&wf.cipher_hex).context("bad cipher hex")?;
    let key = kdf(password, &salt, wf.kdf_iter);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("aes key");
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| anyhow!("password incorrect or data corrupted"))?;
    Ok(String::from_utf8(plain).context("utf8 error")?)
}

// ======== 命令实现 ========
fn cmd_create(wallet_path: &PathBuf, args: CreateArgs) -> Result<()> {
    if wallet_path.exists() && !args.force {
        return Err(anyhow!(
            "钱包文件已存在：{}（可加 --force 覆盖）",
            wallet_path.display()
        ));
    }

    let network: Network = args.network.into();
    let language = parse_language(&args.language)?;

    // 1) 生成助记词
    let wcount: usize = if let Some(words) = args.words {
        match words {
            12 | 15 | 18 | 21 | 24 => words,
            _ => return Err(anyhow!("words 必须为 12/15/18/21/24")),
        }
    } else if let Some(bits) = args.strength {
        match bits {
            128 => 12,
            160 => 15,
            192 => 18,
            224 => 21,
            256 => 24,
            _ => return Err(anyhow!("strength 必须为 128/160/192/224/256")),
        }
    } else {
        12
    };
    let mnemonic = Mnemonic::generate_in(language, wcount)?;

    // 2) 构建种子上下文并派生地址
    let ctx = SeedCtx::new(network, mnemonic.clone(), &args.passphrase)?;
    let coin_type = BtcWallet::default_coin_type(network, args.coin_type);
    let btc = BtcWallet::new(network, args.kind, coin_type);
    let purpose = btc.purpose();
    let (account_xpub, acc_path, btc_addr) =
        btc.derive_account_and_address(&ctx, args.account, args.change, args.index)?;
    let eth = EthWallet::new();
    let eth_address = eth.derive_address(&ctx, args.account, args.change, args.index)?;

    // 3) 使用密码加密助记词并保存钱包文件
    let mut wf = encrypt_mnemonic(&args.password, &mnemonic)?;
    wf.network = network.to_string();
    let json = serde_json::to_string_pretty(&wf)?;
    fs::write(wallet_path, json)
        .with_context(|| format!("写入钱包文件失败：{}", wallet_path.display()))?;

    // 4) 打印结果（不泄露密码与密文）
    let out = WalletOut {
        network: network.to_string(),
        kind: format!("b{}", purpose),
        purpose,
        path_account: acc_path.to_string(),
        path_addr: format!("{}/{}", args.change, args.index),
        account_xpub: account_xpub.to_string(),
        account_fpr: btc.account_fpr_hex(&ctx),
        btc_address: btc_addr.to_string(),
        eth_address,
        mnemonic: mnemonic.to_string(),
        seed_hex: None,
        account_xprv: None,
    };
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}

fn cmd_import(wallet_path: &PathBuf, args: ImportArgs) -> Result<()> {
    if wallet_path.exists() {
        // 为安全起见，此命令不覆盖现有文件（可用 create --force）
        return Err(anyhow!(
            "钱包文件已存在：{}（请删除或使用 create --force 覆盖）",
            wallet_path.display()
        ));
    }
    let network: Network = args.network.into();
    // 仅 English 词表
    let mnemonic = Mnemonic::parse_in(Language::English, &args.mnemonic)
        .context("导入助记词解析失败（当前仅启用 English 词表）")?;

    let ctx = SeedCtx::new(network, mnemonic.clone(), &args.passphrase)?;
    let coin_type = BtcWallet::default_coin_type(network, args.coin_type);
    let btc = BtcWallet::new(network, args.kind, coin_type);
    let purpose = btc.purpose();
    let (account_xpub, acc_path, btc_addr) =
        btc.derive_account_and_address(&ctx, args.account, args.change, args.index)?;
    let eth = EthWallet::new();
    let eth_address = eth.derive_address(&ctx, args.account, args.change, args.index)?;

    let mut wf = encrypt_mnemonic(&args.password, &mnemonic)?;
    wf.network = network.to_string();
    let json = serde_json::to_string_pretty(&wf)?;
    fs::write(wallet_path, json)
        .with_context(|| format!("写入钱包文件失败：{}", wallet_path.display()))?;

    let out = WalletOut {
        network: network.to_string(),
        kind: format!("b{}", purpose),
        purpose,
        path_account: acc_path.to_string(),
        path_addr: format!("{}/{}", args.change, args.index),
        account_xpub: account_xpub.to_string(),
        account_fpr: btc.account_fpr_hex(&ctx),
        btc_address: btc_addr.to_string(),
        eth_address,
        mnemonic: mnemonic.to_string(),
        seed_hex: None,
        account_xprv: None,
    };
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}

fn cmd_export_mnemonic(wallet_path: &PathBuf, args: ExportArgs) -> Result<()> {
    let data = fs::read_to_string(wallet_path)
        .with_context(|| format!("读取钱包文件失败：{}", wallet_path.display()))?;
    let wf: WalletFile = serde_json::from_str(&data).context("钱包文件格式错误")?;
    let mnemonic_str = decrypt_mnemonic(&args.password, &wf)?;
    println!("{}", mnemonic_str);
    Ok(())
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Create(args) => cmd_create(&cli.wallet, args),
        Command::Import(args) => cmd_import(&cli.wallet, args),
        Command::ExportMnemonic(args) => cmd_export_mnemonic(&cli.wallet, args),
    }
}

fn main() {
    if let Err(e) = run() {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}
