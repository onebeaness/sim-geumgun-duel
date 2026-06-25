"""커스텀 게임 컴포넌트 (바닐라 JS, 빌드 단계 없음).

frontend/ 디렉터리의 정적 파일(index.html / main.js / style.css)을
Streamlit 이 그대로 서빙합니다. 별도 Node 빌드가 필요 없습니다.
"""
import os
import streamlit.components.v1 as components

_FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
_duel_arena = components.declare_component("duel_arena", path=_FRONTEND_DIR)


def duel_arena(mode="solo", difficulty="normal", config=None, key=None, default=None):
    """결투 아레나 컴포넌트.

    반환값: 컴포넌트가 setComponentValue 로 보낸 마지막 JSON (없으면 default).
    """
    return _duel_arena(
        mode=mode,
        difficulty=difficulty,
        config=config or {},
        key=key,
        default=default,
    )
