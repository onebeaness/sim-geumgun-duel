-- 심: 금군 듀얼 — 초기 스키마 (Phase 2)
-- Supabase 대시보드 → SQL Editor 에 그대로 붙여넣고 RUN 하세요.

-- 플레이어 (익명 UUID + 닉네임)
create table if not exists public.players (
  id         uuid primary key,                 -- 브라우저/세션 익명 UUID
  nickname   text not null,
  rating     int  not null default 1000,        -- PvP 에서만 변동(Phase 3)
  created_at timestamptz not null default now()
);

-- 매치 메타
create table if not exists public.matches (
  id              uuid primary key default gen_random_uuid(),
  player_a        uuid references public.players(id),
  player_b        uuid,                          -- solo 는 null(봇)
  mode            text not null check (mode in ('solo','pvp')),
  difficulty      text,                          -- solo 봇 난이도
  winner          text check (winner in ('a','b')),  -- a=player_a, b=상대/봇
  voided          boolean not null default false,    -- 기록 미반영(연결끊김 등)
  exchanges       int,
  avg_reaction_ms int,
  best_reaction_ms int,
  started_at      timestamptz default now(),
  ended_at        timestamptz default now()
);
create index if not exists idx_matches_player_a on public.matches(player_a);

-- 교환(턴) 단위 원시 기록 — 대시보드의 원천
create table if not exists public.turns (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches(id) on delete cascade,
  turn_no    int  not null,
  attacker   text not null,                      -- 'player' | 'opp'
  defender   text not null,
  direction  text,                               -- left|center|right (타임아웃이면 null)
  reaction_ms int,                               -- 방어자 반응(null=미입력/타임아웃)
  defended   boolean not null,
  window_ms  int,
  cause      text,                               -- defense | timeout | null
  created_at timestamptz not null default now()
);
create index if not exists idx_turns_match on public.turns(match_id);

-- 순위 집계 뷰
create or replace view public.rankings as
select
  p.id        as player_id,
  p.nickname,
  p.rating,
  min(t.reaction_ms)              as best_reaction,
  round(avg(t.reaction_ms))::int  as avg_reaction,
  count(distinct m.id) filter (where m.winner = 'a') as wins,
  count(distinct m.id)                               as games
from public.players p
left join public.matches m on m.player_a = p.id and not m.voided
left join public.turns   t on t.match_id = m.id and t.defender = 'player'
group by p.id, p.nickname, p.rating;

-- RLS: 활성화(정책 없음) → 서버사이드 service_role 키만 접근.
-- 브라우저/anon 은 DB 직접 접근 불가. (Phase 3 에서 Realtime 위해 anon 정책 추가 예정)
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.turns   enable row level security;
