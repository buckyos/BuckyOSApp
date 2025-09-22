export default {
    common: {
        language: {
            en: "English",
            zh: "中文",
            switch_label: "Language",
        },
        back: "Back",
        actions: {
            start: "Start",
            next: "Next",
            done: "Done",
            save: "Save",
            backed_up: "I've Backed It Up",
            create_did: "Create DID",
            cancel: "Cancel",
            delete: "Delete",
        },
        error: {
            passwords_mismatch: "Passwords do not match.",
            password_too_short: "Password must be at least 6 characters long.",
            mnemonic_mismatch:
                "Mnemonic phrases do not match. Please check your backup.",
            generate_mnemonic_failed: "Failed to generate mnemonic: {{message}}",
            create_did_failed: "Failed to create DID: {{message}}",
        },
        creating: "Creating DID...",
    },
    tabs: {
        home: "Home",
        apps: "Apps",
        setting: "Setting",
    },
    welcome: {
        title: "Create Decentralized Identity (DID)",
        description:
            "Welcome! This wizard will guide you through creating your secure and decentralized identity.",
        app_name: "BuckyOS",
        subtitle: "Secure Decentralized Identity Management",
        import_did: "Import DID",
    },
    create: {
        title: "Set Nickname & Password",
        title_new: "Create DID",
        subtitle: "Setup your secure DID",
        nickname_label: "Username",
        nickname_placeholder: "Enter Nickname",
        password_label: "Password",
        password_placeholder: "Enter Password (min 6 characters)",
        confirm_label: "Confirm Password",
        confirm_password_placeholder: "Confirm Password",
    },
    showMnemonic: {
        title: "Backup Your Mnemonic",
        subtitle: "Write these words in exact order",
        tips:
            "Write down these 12 words in order and keep them in a safe place. This is the only way to recover your account.",
    },
    confirmMnemonic: {
        title: "Confirm Your Mnemonic",
        tips:
            "To ensure you have backed up your phrase correctly, please enter it below.",
        placeholder: "Enter the 12 words separated by spaces...",
        instruction: "Please click the following words in order",
        error_wrong_order: "Incorrect order. Please try again.",
    },
    success: {
        title: "Creation Successful!",
        desc: "Your DID has been created and stored securely.",
        nickname: "Nickname:",
        btc: "BTC Address:",
        eth: "ETH Address:",
    },
    settings: {
        title: "Settings",
        language: "Language",
        delete_account: "Delete Account",
        delete_title: "Delete Account",
        delete_confirm: "Delete current account and return to Welcome? This cannot be undone.",
        languages_title: "Languages",
    },
    sn: {
        invite_label: "SN Invite Code",
        invite_placeholder: "Enter invite code",
        register_option: "Register an SN account while creating DID",
        what_is: "What is SN?",
        title: "What is SN?",
        content: "SN是XXXX",
    },
};
