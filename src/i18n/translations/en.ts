export default {
  common: {
    language: {
      en: "English",
      zh: "中文",
      switch_label: "Language",
    },
    actions: {
      start: "Start",
      next: "Next",
      done: "Done",
      backed_up: "I've Backed It Up",
      create_did: "Create DID",
    },
    error: {
      passwords_mismatch: "Passwords do not match.",
      password_too_short: "Password must be at least 8 characters long.",
      mnemonic_mismatch:
        "Mnemonic phrases do not match. Please check your backup.",
      generate_mnemonic_failed: "Failed to generate mnemonic: {{message}}",
      create_did_failed: "Failed to create DID: {{message}}",
    },
    creating: "Creating DID...",
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
    title: "Step 1: Set Nickname and Password",
    nickname_placeholder: "Enter Nickname",
    password_placeholder: "Enter Password (min 8 characters)",
    confirm_password_placeholder: "Confirm Password",
  },
  showMnemonic: {
    title: "Step 2: Backup Your Mnemonic Phrase",
    tips:
      "Write down these 12 words in order and keep them in a safe place. This is the only way to recover your account.",
  },
  confirmMnemonic: {
    title: "Step 3: Confirm Your Mnemonic Phrase",
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
};
