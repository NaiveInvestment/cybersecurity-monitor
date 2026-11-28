// Source-reviewed facts belong to dated episodes. Later reports keep their own attribution.
export const impactNotes = [
  {
    id:"sap-dev-202611", name:"SAP", region:"GL", first:"2026-11-27T04:26:32Z",
    names:["SAP"], match:/\bSAP\b/i, topic:/GitHub|Project Granite|소스\s?코드|source code|SAP (?:confirms|flags|hit by|finds no signs)|SAP.{0,20}해킹 사고/i,
    type:["infra","technical"], priority:3, role:"기업용 소프트웨어 공급자",
    title:"SAP 개발 환경에서 의심 활동",
    scope:"인증 토큰과 소스코드 접근 보도. 고객 업무 데이터는 별도 조사 대상.",
    attack:"GitHub 개발 환경 침해 보도", impact:"인증 토큰과 소스코드 접근 보도. 고객 업무 데이터 접근 증거 미발견(SAP)",
    milestones:[
      ["11.26","최초 보도","슈피겔이 내부 자료를 토대로 개발 환경 침해 의혹을 보도했습니다.","The Record","https://therecord.media/sap-germany-cyberattack-github"],
      ["11.27","회사 입장","SAP는 의심 활동을 발견해 대응했으며, 조사 시점까지 고객 업무 데이터 무단 접근 증거는 찾지 못했다고 밝혔습니다.","SecurityWeek","https://www.securityweek.com/sap-confirms-cyberattack-source-code-reportedly-compromised/","2026-11-27T02:36:00-05:00"],
    ],
  },
  {
    id:"cloud-one-202611", name:"미 공군 Cloud One", region:"GL", first:"2026-11-27T12:03:04Z",
    names:["Air Force Cloud One","Cloud One"], match:/cloud\s*one|클라우드\s*원|(?:미(?:국)?\s*공군|air force).{0,35}(?:클라우드|cloud)/i,
    topic:/breach|hack|cyberattack|해킹|침해/i, type:["infra"], priority:3, role:"군 공용 클라우드",
    title:"미 공군 Cloud One 침해 보도", scope:"보도 대상은 공군의 공용 클라우드입니다. 유출 항목과 규모는 미공개입니다.",
    attack:"군 공용 클라우드 침해 보도", impact:"유출 항목과 피해 규모 미공개. 미 공군 논평 유보",
    milestones:[
      ["11.27","취재 보도","로이터가 복수의 관계자를 인용해 미 공군 클라우드 침해를 보도했습니다.","CBS News","https://www.cbsnews.com/news/u-s-air-force-cloud-platform-breached-by-hackers/","2026-11-27T18:25:00-05:00"],
      ["11.27","기관 입장","미 공군은 특정 시스템의 보안 및 운영 상태에는 논평하지 않는다고 CBS에 답했습니다.","CBS News","https://www.cbsnews.com/news/u-s-air-force-cloud-platform-breached-by-hackers/","2026-11-27T18:25:00-05:00"],
    ],
  },
  {
    id:"post-202611", name:"인터넷우체국", region:"KR", first:"2026-11-27T07:03:35Z",
    names:["인터넷우체국","우정사업본부"], match:/인터넷우체국|우정사업본부|우체국.{0,12}(?:뚫|털|해킹)|\bKorea Post\b/i, topic:/해킹|유출|털렸|breach|leak/i,
    type:["personal"], priority:2, role:"등기우편 배달장소 변경 서비스",
    title:"인터넷우체국, 하루치 분석에서 113,855명 유출 확인", scope:"등기 고객 성명, 주소, 전화번호. 113,855명에는 법인이 포함되며 전체 기간 규모는 조사 중입니다.",
    attack:"등기우편 배달장소 변경 서비스 해킹", impact:"성명, 주소, 전화번호 유출. 하루치 113,855명(법인 포함), 전체 규모 조사 중",
    milestones:[
      ["11.27","기관 발표","우정사업본부는 17~24일 가운데 하루치 분석 결과를 공개했습니다. 전체 기간의 중복을 제거한 피해 규모는 조사 중입니다.","한겨레","https://www.hani.co.kr/arti/society/society_general/1289501.html","2026-11-28T00:52:00+09:00"],
    ],
  },
  {
    id:"danawa-202611", name:"다나와", region:"KR", first:"2026-11-26T05:56:26Z", names:["다나와"],
    match:/다나와|\bDanawa\b/i, topic:/해킹|침해|보안\s?사고|회원정보|서비스.{0,16}(?:재개|중단)|먹통/,
    type:["operations","personal"], priority:2,role:"가격비교 플랫폼",
    title:"다나와 서비스 중단과 회원정보 유출",scope:"회사 발표에 따르면 성명, 아이디, 전화번호가 유출됐습니다. 피해 회원 수는 미공개입니다.",
    attack:"외부 침해로 가격비교 서비스 중단", impact:"회원 성명, 아이디, 전화번호 유출. 피해 인원 미공개",
    milestones:[
      ["11.26","서비스 중단","외부 침해가 의심돼 서비스 이용을 중단했고 당시에는 유출 여부를 조사하고 있었습니다.","뉴스1","https://www.fnnews.com/news/202611261838550968"],
      ["11.28","회사 입장","일부 회원정보 유출을 확인했습니다. 회사는 비밀번호와 결제정보는 유출되지 않았다고 설명했습니다.","이데일리","https://www2.edaily.co.kr/News/Read?mediaCodeNo=257&newsId=01738406645650312","2026-11-28T17:38:56+09:00"],
    ],
  },
  {
    id:"fsi-202611", name:"금융보안원", region:"KR", first:"2026-11-10T10:43:14Z", names:["금융보안원","금보원"],
    match:/금융보안원|금보원/, topic:/상시\s?평가|보안\s?평가|해킹당|정보\s?유출된 금융보안원|금융보안원.{0,8}해킹/,
    type:["infra","personal"],priority:3,role:"금융회사 상시평가 시스템",
    title:"금융보안원 상시평가 시스템 정보 유출",scope:"행정서식 약 200건, 서식 내 개인정보 300여 건, 마스킹된 이용자 정보 350여 건.",
    attack:"금융회사 상시평가 시스템 무단 접근", impact:"행정서식 약 200건, 서식 내 개인정보 300여 건, 마스킹된 이용자 정보 350여 건",
    milestones:[
      ["11.10","기관 발표","금융보안원은 전날 비정상 접근을 확인해 접속을 차단했다고 밝혔습니다. 발표한 세 범주는 서로 다른 자료 단위입니다.","금융보안원","https://www.fsec.or.kr/bbs/detail?bbsNo=12144&menuNo=69","2026-11-10"],
    ],
  },
];
