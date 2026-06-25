# 심: 금군 듀얼 ⚔️

반응속도 기반 1:1 검술 결투. 공격과 방어를 번갈아, 더 빨리·정확히 막는 자가 살아남는다.

- **Streamlit** = 셸·라우팅·대시보드
- **커스텀 컴포넌트(바닐라 JS, 빌드 없음)** = 게임 코어(아레나·키보드·고정밀 타이머·램프·봇)
- **Supabase** = 매칭·실시간 동기화·저장 (Phase 2~)

## 실행

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py
```

## 구조

```
app.py                 멀티페이지 네비게이션 엔트리
views/                 lobby / tutorial / dashboard 페이지
game_component/        커스텀 컴포넌트 (frontend = index.html/main.js/style.css)
lib/config.py          확정 게임 상수(목숨·램프·봇·레이팅·매칭)
assets/                이미지 에셋 + ASSET_MANIFEST.md (1인칭 3레이어)
.streamlit/            테마(config.toml) + secrets 템플릿
```

## 확정 규칙 요약

- **목숨 3개**: 방어 실패(틀린 방향/시간초과) 또는 공격 타임아웃(5초) → 목숨 -1, 0이면 패배
- **적응형 램프**: `window = clamp(최근평균반응 × 1.5, 250, 1200)`ms, 초기 800, 방어자별 독립
- **측정**: 큐 페인트 직후 `performance.now()`, 큐 전 랜덤지연(300~1200ms), <100ms 거부 → "너무 빨랐음" + 재시도
- **봇**: 쉬움/보통/어려움(반응 분포 + 오답률)
- **신원**: 익명 UUID + 닉네임(2~12자, 특수문자 불가), 로그인 없음
- **레이팅**: PvP 만 변동(base 1000 / K 32), 실력검정 5회로 초기 시드
- **매칭**: 첫 8초 레이팅 근접 → 이후 FIFO. 통신 두절은 v1 기록 미반영

## 로드맵

- [x] **Phase 0** — 골격: 멀티페이지 셸, 게임 컴포넌트 파이프라인 점검
- [ ] **Phase 1** — 솔로 코어: 아레나 렌더·반응 측정·램프·목숨·봇
- [ ] **Phase 2** — Supabase 저장 + 대시보드
- [ ] **Phase 3** — PvP 매칭·Realtime·로컬 측정 공정성
- [ ] **Phase 4** — 순위·레이팅(ELO)·치팅 검증·엣지케이스
