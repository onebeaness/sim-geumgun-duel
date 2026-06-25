"""Page 2 — 대시보드. Supabase turns/matches/rankings 집계."""
import pandas as pd
import plotly.express as px
import streamlit as st

from lib import db

st.title("📊 대시보드")

if not db.is_enabled():
    st.info(
        "DB 미설정 상태입니다. `.streamlit/secrets.toml`(로컬) 또는 Streamlit Cloud Secrets 에 "
        "`[supabase] url`, `service_role_key` 를 넣으면 전적·순위가 표시됩니다."
    )
    st.stop()

pid = st.session_state.get("player_uuid")
if not pid:
    st.warning("먼저 **결투장**에서 닉네임을 입력하고 한 판 플레이하세요.")
    st.stop()

turns = db.fetch_player_defense_turns(pid)
matches = db.fetch_player_matches(pid)
rankings = db.fetch_rankings(50)

dft = pd.DataFrame(turns)
dfm = pd.DataFrame(matches)
dfr = pd.DataFrame(rankings)
reacts = dft["reaction_ms"].dropna() if "reaction_ms" in dft else pd.Series(dtype=float)

# ===== 전적 요약 =====
st.subheader("전적 요약")
if not dfm.empty:
    valid = dfm[~dfm["voided"].fillna(False)]
    wins = int((valid["winner"] == "a").sum())
    losses = int((valid["winner"] == "b").sum())
    avg_exch = round(valid["exchanges"].dropna().mean(), 1) if valid["exchanges"].notna().any() else "—"
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("승", wins)
    c2.metric("패", losses)
    c3.metric("평균 교환", avg_exch)
    c4.metric("최고 반응", f"{int(reacts.min())}ms" if not reacts.empty else "—")
else:
    st.caption("아직 기록이 없습니다. 한 판 플레이해보세요.")

# ===== 반응 분포 / 방향 편차 =====
if not reacts.empty:
    left, right = st.columns(2)
    with left:
        st.subheader("반응 분포")
        fig = px.histogram(dft.dropna(subset=["reaction_ms"]), x="reaction_ms", nbins=20)
        fig.update_layout(xaxis_title="반응 (ms)", yaxis_title="횟수", bargap=0.05, height=320)
        st.plotly_chart(fig, use_container_width=True)
    with right:
        st.subheader("방향별 편차")
        g = (dft.dropna(subset=["reaction_ms"]).groupby("direction")
             .agg(avg_ms=("reaction_ms", "mean"), hit=("defended", "mean"), n=("reaction_ms", "size"))
             .reset_index())
        g["avg_ms"] = g["avg_ms"].round()
        g["막기%"] = (g["hit"] * 100).round(1)
        g["방향"] = g["direction"].map({"left": "좌", "center": "중", "right": "우"}).fillna(g["direction"])
        fig2 = px.bar(g, x="방향", y="avg_ms", text="avg_ms")
        fig2.update_layout(yaxis_title="평균 반응(ms)", height=320)
        st.plotly_chart(fig2, use_container_width=True)
        st.dataframe(
            g[["방향", "avg_ms", "막기%", "n"]].rename(columns={"avg_ms": "평균ms", "n": "표본"}),
            hide_index=True, use_container_width=True,
        )

# ===== 성장 추세 =====
if not dfm.empty and dfm["avg_reaction_ms"].notna().any():
    st.subheader("성장 추세 (매치별 평균 반응)")
    d = dfm.dropna(subset=["avg_reaction_ms"]).sort_values("ended_at").reset_index(drop=True)
    d["매치"] = range(1, len(d) + 1)
    fig3 = px.line(d, x="매치", y="avg_reaction_ms", markers=True)
    fig3.update_layout(yaxis_title="평균 반응(ms)", height=320)
    st.plotly_chart(fig3, use_container_width=True)

# ===== 전역 순위 + 내 백분위 =====
st.subheader("전역 순위표")
if not dfr.empty:
    show = dfr.copy().reset_index(drop=True)
    show.insert(0, "순위", range(1, len(show) + 1))
    st.dataframe(
        show[["순위", "nickname", "rating", "best_reaction", "avg_reaction", "wins", "games"]].rename(
            columns={"nickname": "닉네임", "rating": "레이팅", "best_reaction": "최고",
                     "avg_reaction": "평균", "wins": "승", "games": "판"}),
        hide_index=True, use_container_width=True,
    )
    mine = dfr[dfr["player_id"] == pid]
    allavg = dfr["avg_reaction"].dropna()
    if not mine.empty and pd.notna(mine.iloc[0]["avg_reaction"]) and len(allavg) > 1:
        my_avg = mine.iloc[0]["avg_reaction"]
        faster_than = (allavg > my_avg).mean() * 100  # 나보다 느린 사람 비율
        st.metric("내 반응 위치", f"상위 {round(100 - faster_than)}%", help=f"내 평균 {int(my_avg)}ms")
else:
    st.caption("순위 데이터가 아직 없습니다.")
