# Parceiro de Jornada (Buddy)

## Fluxo de realtime

O realtime usa **Supabase Realtime** com duas fontes:

1. `user_presence`
- heartbeat a cada 60s atualiza `is_online=true`, `last_seen_at`, `quit_date` e `display_name`.
- ao sair do app, salvar `is_online=false`.

2. `buddy_live_state`
- snapshot de progresso do usuario (`minutes_since_quit`, marcos, progresso etc.).
- parceiro assina updates desta tabela para render ao vivo.

## Canais assinados no cliente

- `buddy-conn-{userId}`: `postgres_changes` em `buddy_connections` para detectar aceite/encerramento.
- `buddy-presence-{buddyId}`: `postgres_changes` em `user_presence` para online/offline.
- `buddy-live-{buddyId}`: `postgres_changes` em `buddy_live_state` para progresso e milestone.

## Eventos de UI disparados

- `buddy_update`: update de progresso do parceiro (via `buddy_live_state`).
- `buddy_milestone_achieved`: quando `current_milestone_label` muda.
- `buddy_online_status`: quando `is_online` muda.

## Offline

O ultimo estado conhecido fica salvo em `localStorage` (`respiraBuddyCache`) e exibido com timestamp.
