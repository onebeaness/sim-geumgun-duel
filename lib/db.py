"""Supabase 접근 계층 (Phase 2).

모든 DB 접근은 서버사이드(Streamlit 파이썬)에서 service_role 키로 수행합니다.
secrets 가 없으면 모든 함수가 안전하게 no-op/None 을 반환하므로,
DB 미설정 상태에서도 솔로 게임은 정상 동작합니다.
"""
from __future__ import annotations

import streamlit as st

try:
    from supabase import create_client, Client
except Exception:  # supabase 미설치 환경 방어
    create_client = None
    Client = None


@st.cache_resource(show_spinner=False)
def get_client():
    if create_client is None:
        return None
    try:
        s = st.secrets.get("supabase", {})
    except Exception:
        return None
    url = s.get("url")
    key = s.get("service_role_key") or s.get("anon_key")
    if not url or not key or "YOUR_" in str(key):
        return None
    try:
        return create_client(url, key)
    except Exception:
        return None


def is_enabled() -> bool:
    return get_client() is not None


def upsert_player(player_id: str, nickname: str) -> None:
    c = get_client()
    if not c:
        return
    try:
        c.table("players").upsert(
            {"id": player_id, "nickname": nickname}, on_conflict="id"
        ).execute()
    except Exception as e:  # 저장 실패가 게임을 막지 않도록
        st.session_state["_db_error"] = str(e)


def save_match(match_id: str, player_id: str, mode: str, difficulty: str | None,
               winner: str | None, voided: bool, exchanges, avg_ms, best_ms) -> None:
    c = get_client()
    if not c:
        return
    try:
        c.table("matches").insert({
            "id": match_id, "player_a": player_id, "player_b": None,
            "mode": mode, "difficulty": difficulty,
            "winner": winner, "voided": voided,
            "exchanges": exchanges, "avg_reaction_ms": avg_ms, "best_reaction_ms": best_ms,
        }).execute()
    except Exception as e:
        st.session_state["_db_error"] = str(e)


def save_turns(match_id: str, turns: list[dict]) -> None:
    c = get_client()
    if not c or not turns:
        return
    rows = [{
        "match_id": match_id,
        "turn_no": t.get("turn_no"),
        "attacker": t.get("attacker"),
        "defender": t.get("defender"),
        "direction": t.get("direction"),
        "reaction_ms": t.get("reaction_ms"),
        "defended": bool(t.get("defended")),
        "window_ms": t.get("window_ms"),
        "cause": t.get("cause"),
    } for t in turns]
    try:
        c.table("turns").insert(rows).execute()
    except Exception as e:
        st.session_state["_db_error"] = str(e)


def fetch_player_defense_turns(player_id: str) -> list[dict]:
    """이 플레이어가 '방어자'였던 모든 턴(반응 기록 원천)."""
    c = get_client()
    if not c:
        return []
    try:
        m = c.table("matches").select("id").eq("player_a", player_id).eq("voided", False).execute()
        ids = [r["id"] for r in (m.data or [])]
        if not ids:
            return []
        t = (c.table("turns").select("direction,reaction_ms,defended,window_ms,created_at,match_id")
             .in_("match_id", ids).eq("defender", "player").execute())
        return t.data or []
    except Exception as e:
        st.session_state["_db_error"] = str(e)
        return []


def fetch_player_matches(player_id: str) -> list[dict]:
    c = get_client()
    if not c:
        return []
    try:
        r = (c.table("matches").select("*").eq("player_a", player_id)
             .order("ended_at", desc=True).execute())
        return r.data or []
    except Exception as e:
        st.session_state["_db_error"] = str(e)
        return []


def fetch_rankings(limit: int = 50) -> list[dict]:
    c = get_client()
    if not c:
        return []
    try:
        r = c.table("rankings").select("*").order("rating", desc=True).limit(limit).execute()
        return r.data or []
    except Exception as e:
        st.session_state["_db_error"] = str(e)
        return []
