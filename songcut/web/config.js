/* 쏭컷 랜딩페이지 설정 — 가격·결제 링크·문의처는 여기 한 곳에서만 고친다.
 * link 에는 결제 페이지 주소를 넣는다(예: 토스페이먼츠 결제 링크, 스마트스토어 상품, Stripe Payment Link, 탈잉·클래스101 상품 페이지).
 * link 를 비워 두면 단추가 「문의하기」로 바뀌어 contact 로 이어진다.
 * ★아래 가격과 구성은 예시다. 실제 판매 전에 꼭 바꾼다. */
window.SONGCUT = {
  brand: "크리메타쏭",
  npmPackage: "creimeta-songcut",
  contact: "",            // 예: "mailto:hello@example.com" 또는 카카오톡 채널 주소
  packages: [
    {
      id: "free",
      name: "무료",
      price: "0원",
      desc: "혼자 써 보는 분",
      items: ["쏭컷 웹 편집기 (공백 자르기 · 쇼츠 · 제목 · 자막)", "클로드 코드 스킬 songcut 한 줄 설치", "구간 JSON · ffmpeg 명령 내보내기"],
      cta: "웹 편집기 열기",
      link: "editor.html",
    },
    {
      id: "basic",
      name: "크리에이터 팩",
      price: "9,900원",
      desc: "쇼츠를 꾸준히 올리는 분",
      items: ["무료 구성 전부", "강의·리뷰용 자막 스타일 프리셋 10종", "첫 3초 후킹 문구 템플릿 50개", "캔바 쇼츠 썸네일 템플릿 5종", "설치·사용 영상 가이드"],
      cta: "구매하기",
      link: "",
      best: true,
    },
    {
      id: "class",
      name: "강의 패키지",
      price: "49,000원",
      desc: "기관·학교에서 가르치는 분",
      items: ["크리에이터 팩 전부", "2시간 실습 교안(HWP·PPT·노션)", "수강생용 실습 영상 3종 + 정답 파일", "수업 중 막히는 곳 FAQ", "강사 1명 강의 사용권"],
      cta: "구매하기",
      link: "",
    },
  ],
};
