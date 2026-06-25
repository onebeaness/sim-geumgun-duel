# 「심: 금군 듀얼」 — 이미지 에셋 명세서 (image-gen 에이전트용)

> 이 문서는 다른 이미지 생성 에이전트에게 그대로 전달하기 위한 사양입니다.
> 게임 컴포넌트는 아래 **파일명 그대로** PNG를 불러옵니다. 파일명/폴더 구조를 바꾸면 코드도 같이 바꿔야 합니다.
> **확정 전까지는 임시 플레이스홀더 이미지로 개발을 진행**하고, 진짜 PNG가 들어오면 그대로 교체됩니다.

---

## 0. 화면 구성 (1인칭 검술 듀얼, 3레이어 합성)

```
[ 레이어 2 ] 내 손 + 검 (1인칭, 화면 하단 전경)   ← 가장 앞
[ 레이어 1 ] 상대방 (정면, 화면 중앙)              ← 중간
[ 레이어 0 ] 배경                                  ← 가장 뒤
```

- 캔버스 기준 **16:9, 1920×1080** 으로 설계 (컴포넌트가 비율 맞춰 스케일).
- **상대방 / 내 손 = 투명 배경 PNG(알파 채널 필수)**. 배경만 불투명.

## 1. 아트 방향 (확정 필요 — D5)

- 제안 테마: **조선 금군(왕실 호위무사)** — 갑주/철릭, 환도(전통 검). 사극 톤.
- 조명/카메라/캐릭터 외형은 **모든 포즈에서 동일하게 유지**(같은 인물·같은 검·같은 의상). ← img-gen에서 가장 중요. 캐릭터 시트/동일 시드/레퍼런스 이미지 방식 권장.

---

## 2. 배경 (`assets/img/bg/`) — 불투명 PNG, 1920×1080

| 파일명 | 용도 |
|---|---|
| `bg_arena.png` | 결투장 배경 (1장) |

> 승리/패배 화면의 색 변화는 코드(CSS 오버레이)로 처리 → 별도 배경 PNG 불필요.

## 3. 상대방 (`assets/img/opponent/`) — 투명 PNG, 권장 1024×1024+, 정면

| 파일명 | 상태 | 사용 시점 |
|---|---|---|
| `opp_idle.png` | 대기 | 턴 사이 기본 자세 |
| `opp_attack_left.png` | 공격(좌) | **내가 방어자일 때의 큐** — 좌측 베기 |
| `opp_attack_center.png` | 공격(중) | 큐 — 중앙 찌르기 |
| `opp_attack_right.png` | 공격(우) | 큐 — 우측 베기 |
| `opp_block_left.png` | 막기(좌) | 내가 공격할 때 상대가 좌로 막는 모습 |
| `opp_block_center.png` | 막기(중) | 상대가 중앙 막기 |
| `opp_block_right.png` | 막기(우) | 상대가 우측 막기 |
| `opp_win.png` | 승리 | 내가 졌을 때 (상대 승리 포즈) |
| `opp_lose.png` | 패배 | 내가 이겼을 때 (상대 피격/패배 포즈) |

> 막기 3종(`opp_block_*`)은 폴리시용. 초기엔 `opp_idle` + 이펙트로 대체 가능 → **후순위 생성 OK**.

## 4. 내 손 + 검 (`assets/img/hand/`) — 투명 PNG, 권장 1920×1080, 화면 하단 전경

| 파일명 | 상태 | 사용 시점 |
|---|---|---|
| `hand_idle.png` | 대기 | 검을 든 기본 자세 |
| `hand_attack_left.png` | 공격(좌) | 내가 공격자, 좌 선택 |
| `hand_attack_center.png` | 공격(중) | 중앙 선택 |
| `hand_attack_right.png` | 공격(우) | 우 선택 |
| `hand_block_left.png` | 막기(좌) | 내가 방어자, 좌 막기 |
| `hand_block_center.png` | 막기(중) | 중앙 막기 |
| `hand_block_right.png` | 막기(우) | 우 막기 |

---

## 5. 게임 상태 → 표시 이미지 매핑 (코드 참조용)

| 게임 상태 | 배경 | 상대방 | 내 손 |
|---|---|---|---|
| 대기 | bg_arena | opp_idle | hand_idle |
| 내가 공격 (방향 X) | bg_arena | opp_block_X | hand_attack_X |
| 내가 방어 — 큐 등장 (방향 X) | bg_arena | **opp_attack_X** | hand_idle |
| 내가 방어 — 막기 성공 (방향 X) | bg_arena | opp_attack_X | hand_block_X |
| 매치 승리 | bg_arena | opp_lose | hand_idle(or win) |
| 매치 패배 | bg_arena | opp_win | hand_idle(or lose) |

(X = left / center / right)

---

## 6. 생성 우선순위

1. **1순위 (솔로 코어 검증용)**: `bg_arena`, `opp_idle`, `opp_attack_left/center/right`, `opp_win`, `opp_lose`, `hand_idle`, `hand_attack_left/center/right`, `hand_block_left/center/right`
2. **2순위 (폴리시)**: `opp_block_left/center/right`

## 7. 합계

- 1순위: 14장 / 2순위: 3장 / **총 17장**
