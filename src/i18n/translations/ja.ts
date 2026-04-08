import en from "./en";

const ja = {
    ...en,
    common: {
        ...en.common,
        error: {
            ...en.common.error,
            import_did_failed: "アカウントのインポートに失敗しました: {{message}}",
        },
        creating: "アカウントを作成し、SN をバインドしています...",
        importing: "アカウントをインポートしています...",
    },
    welcome: {
        ...en.welcome,
        create_account: "アカウントを作成",
        import_did: "アカウントをインポート",
    },
    import: {
        ...en.import,
        title: "アカウントをインポート",
        subtitle:
            "ニーモニックフレーズとパスワードを入力してください。アプリはまず公開鍵で SN レコードを照会し、SN レコードがあるアカウントのみインポートできます。",
        auto_name_hint:
            "名前を手動で入力する必要はありません。SN レコードが見つかった場合、アプリは SN 上の名前をこのアカウントのローカル表示名として自動的に使用します。",
        submit: "アカウントをインポート",
        error: {
            ...en.import.error,
            mnemonic_required: "ニーモニックフレーズを入力してください。",
            invalid_mnemonic_word: "{{word}} は有効なニーモニック単語ではありません",
            nickname_exists: "この名前は既に存在します。",
            identity_exists: "このアカウントはこのデバイスに既に存在します。",
            sn_not_found: "この DID に対応する SN レコードがありません。インポートに失敗しました。",
        },
    },
    create: {
        ...en.create,
        title_new: "アカウントを作成",
        flow_intro: "このフローでは最初に DID を作成し、その後 SN をバインドします。",
        did_card_title: "DID とは",
        did_card_desc:
            "DID は現在のアプリで使われる基本アイデンティティです。作成後、復元や署名に必要なニーモニックと鍵素材が生成されます。",
        sn_card_title: "SN とは",
        sn_card_desc:
            "BuckyOS SN (Super Node) は、従来のクラウド基盤に依存せず、開発者が P2P ネットワーク上でアプリを構築・デプロイ・拡張できる分散型オペレーティングシステムです。",
        learn_more: "詳細",
        start_button: "作成を開始",
    },
    success: {
        ...en.success,
        title: "アカウント作成完了",
        desc_primary: "おめでとうございます。アカウント {{name}} の作成が完了しました。",
        desc_next_step: "次に OOD をバインドしてください。",
        desc_secondary: "OOD はあなた専用のサーバーであり、個人アプリとデータを安全に保存できます。",
        bind_ood: "OOD をバインド",
    },
    sn: {
        ...en.sn,
        username_format_hint:
            "SNユーザー名は7文字以上で、小文字、数字、ハイフンのみ使用できます。先頭と末尾は英字または数字である必要があります。",
        error: {
            ...en.sn.error,
            username_too_short: "SNユーザー名は 7 文字以上である必要があります。",
            username_exists_local: "この名前はこのデバイスに既にローカル存在しています。",
            active_code_required: "Active Code を入力してください。",
        },
    },
} satisfies typeof en;

export default ja;
