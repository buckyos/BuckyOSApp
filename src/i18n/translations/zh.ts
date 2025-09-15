export default {
  common: {
    language: {
      en: "English",
      zh: "中文",
      switch_label: "语言",
    },
    actions: {
      start: "开始",
      next: "下一步",
      done: "完成",
      backed_up: "我已完成备份",
      create_did: "创建DID",
    },
    error: {
      passwords_mismatch: "两次输入的密码不一致。",
      password_too_short: "密码长度至少需要8个字符。",
      mnemonic_mismatch: "助记词不一致，请检查您的备份。",
      generate_mnemonic_failed: "生成助记词失败：{{message}}",
      create_did_failed: "创建DID失败：{{message}}",
    },
    creating: "正在创建 DID...",
  },
  welcome: {
    title: "创建去中心化身份（DID）",
    description: "欢迎！本向导将引导您创建安全的去中心化身份。",
    app_name: "BuckyOS",
    subtitle: "安全的去中心化身份管理",
    import_did: "导入 DID",
  },
  create: {
    title: "步骤一：设置昵称与密码",
    nickname_placeholder: "输入昵称",
    password_placeholder: "输入密码（至少8个字符）",
    confirm_password_placeholder: "确认密码",
  },
  showMnemonic: {
    title: "步骤二：备份您的助记词",
    tips:
      "请按顺序抄写以下12个单词并妥善保管。这是找回账户的唯一方式。",
  },
  confirmMnemonic: {
    title: "步骤三：确认您的助记词",
    tips: "为确保您已正确备份，请在下方输入助记词。",
    placeholder: "输入12个单词，以空格分隔……",
    instruction: "请按顺序点击以下单词",
    error_wrong_order: "助记词顺序不正确，请重试。",
  },
  success: {
    title: "创建成功！",
    desc: "您的DID已创建并安全保存。",
    nickname: "昵称：",
    btc: "BTC地址：",
    eth: "ETH地址：",
  },
};
