import en from "./en";

const zhTW = {
    ...en,
    common: {
        ...en.common,
        error: {
            ...en.common.error,
            import_did_failed: "匯入帳戶失敗：{{message}}",
        },
        creating: "正在建立帳戶並綁定SN...",
        importing: "正在匯入帳戶...",
    },
    welcome: {
        ...en.welcome,
        create_account: "建立帳戶",
        import_did: "匯入帳戶",
    },
    import: {
        ...en.import,
        title: "匯入帳戶",
        subtitle: "請輸入助記詞與密碼。系統會先依據公鑰查詢 SN 紀錄，只有已存在 SN 紀錄的帳戶才允許匯入。",
        auto_name_hint: "匯入時不需要手動輸入名字；若查到 SN 紀錄，系統會自動使用 SN 上的名字作為此帳戶的本地顯示名稱。",
        submit: "匯入帳戶",
        error: {
            ...en.import.error,
            mnemonic_required: "請輸入助記詞。",
            invalid_mnemonic_word: "{{word}} 不是合法的助記詞",
            nickname_exists: "此名稱已存在。",
            identity_exists: "此帳戶已存在於此裝置。",
            sn_not_found: "目前 DID 在 SN 上無紀錄，匯入失敗。",
        },
    },
    create: {
        ...en.create,
        title_new: "建立帳戶",
        flow_intro: "此流程會先建立DID，然後綁定SN。",
        did_card_title: "DID 是什麼",
        did_card_desc: "DID 是目前應用中的基礎身份。建立後會產生助記詞與密鑰材料，用於恢復、簽名與後續綁定。",
        sn_card_title: "SN 是什麼",
        sn_card_desc:
            "BuckyOS SN (Super Node) 是一個去中心化的作業系統，使開發人員能夠在點對點網路上建構、部署與擴展應用程式，而無需依賴傳統雲端基礎設施。",
        learn_more: "詳細",
        start_button: "開始建立",
    },
    success: {
        ...en.success,
        title: "帳戶建立完成",
        desc_primary: "恭喜，帳戶 {{name}} 建立成功。",
        desc_next_step: "接下來請綁定您的OOD。",
        desc_secondary: "OOD是你的個人伺服器，可以安全地儲存你的個人應用與資料。",
        bind_ood: "綁定OOD",
    },
    sn: {
        ...en.sn,
        username_format_hint: "SN 使用者名稱至少需要 7 個字元，只能包含小寫字母、數字或連字號，並且必須以字母或數字開頭與結尾。",
        error: {
            ...en.sn.error,
            username_too_short: "SN 使用者名稱長度至少需為 7 個字元。",
            username_exists_local: "此名字已在本機存在。",
            active_code_required: "請輸入 Active Code。",
        },
    },
} satisfies typeof en;

export default zhTW;
