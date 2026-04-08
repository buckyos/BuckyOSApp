import en from "./en";

const ko = {
    ...en,
    common: {
        ...en.common,
        error: {
            ...en.common.error,
            import_did_failed: "계정 가져오기에 실패했습니다: {{message}}",
        },
        creating: "계정을 생성하고 SN을 바인딩하는 중...",
        importing: "계정을 가져오는 중...",
    },
    welcome: {
        ...en.welcome,
        create_account: "계정 만들기",
        import_did: "계정 가져오기",
    },
    import: {
        ...en.import,
        title: "계정 가져오기",
        subtitle:
            "니모닉 문구와 비밀번호를 입력하세요. 앱은 먼저 공개키로 SN 기록을 조회하며, SN 기록이 있는 계정만 가져올 수 있습니다.",
        auto_name_hint:
            "이름을 직접 입력할 필요는 없습니다. SN 기록이 조회되면 앱이 SN 상의 이름을 이 계정의 로컬 표시 이름으로 자동 사용합니다.",
        submit: "계정 가져오기",
        error: {
            ...en.import.error,
            mnemonic_required: "니모닉 문구를 입력해 주세요.",
            invalid_mnemonic_word: "{{word}} 는 유효한 니모닉 단어가 아닙니다",
            nickname_exists: "이 이름은 이미 존재합니다.",
            identity_exists: "이 계정은 이 기기에 이미 존재합니다.",
            sn_not_found: "이 DID에 대한 SN 기록이 없습니다. 가져오기에 실패했습니다.",
        },
    },
    create: {
        ...en.create,
        title_new: "계정 만들기",
        flow_intro: "이 흐름은 먼저 DID를 만들고, 그다음 SN을 바인딩합니다.",
        did_card_title: "DID란 무엇인가",
        did_card_desc: "DID는 현재 앱에서 사용하는 기본 신원입니다. 생성 후 복구와 서명에 필요한 니모닉과 키 자료가 만들어집니다.",
        sn_card_title: "SN이란 무엇인가",
        sn_card_desc:
            "BuckyOS SN(Super Node)은 개발자가 전통적인 클라우드 인프라에 의존하지 않고 P2P 네트워크 위에서 애플리케이션을 구축, 배포, 확장할 수 있게 해주는 탈중앙 운영체제입니다.",
        learn_more: "자세히",
        start_button: "생성 시작",
    },
    success: {
        ...en.success,
        title: "계정 생성 완료",
        desc_primary: "축하합니다. 계정 {{name}} 생성이 완료되었습니다.",
        desc_next_step: "이제 OOD를 바인딩하세요.",
        desc_secondary: "OOD는 당신의 개인 서버이며, 개인 앱과 데이터를 안전하게 저장할 수 있습니다.",
        bind_ood: "OOD 바인딩",
    },
    sn: {
        ...en.sn,
        username_format_hint:
            "SN 사용자 이름은 최소 7자 이상이어야 하며 소문자, 숫자, 하이픈만 사용할 수 있습니다. 시작과 끝은 문자 또는 숫자여야 합니다.",
        error: {
            ...en.sn.error,
            username_too_short: "SN 사용자 이름은 최소 7자 이상이어야 합니다.",
            username_exists_local: "이 이름은 이 기기에 이미 로컬로 존재합니다.",
            active_code_required: "Active Code를 입력해 주세요.",
        },
    },
} satisfies typeof en;

export default ko;
