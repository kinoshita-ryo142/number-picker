import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import { isSupabaseConfigured, supabase } from '../lib/supabase.ts'
import type { Clinic, Ticket, TicketStatus } from '../types/queue.ts'

interface AdminPageProps {
  onNavigate: (path: string) => void
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  waiting: '待機中',
  calling: '呼び出し中',
  done: '完了',
  cancelled: 'キャンセル',
}

export function AdminPage({ onNavigate }: AdminPageProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [clinicLoading, setClinicLoading] = useState(false)
  const [newClinicName, setNewClinicName] = useState('')
  const [newClinicSlug, setNewClinicSlug] = useState('')
  const [setupError, setSetupError] = useState<string | null>(null)

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [latestIssued, setLatestIssued] = useState<Ticket | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [copied, setCopied] = useState(false)

  // 認証状態の監視
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // ログイン済みユーザーのクリニック取得
  const loadClinic = useCallback(async (userId: string) => {
    setClinicLoading(true)
    setErrorMsg(null)
    const { data, error } = await supabase
      .from('clinics')
      .select('*')
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<Clinic>()

    if (error) {
      setErrorMsg(error.message)
    } else {
      setClinic(data ?? null)
    }
    setClinicLoading(false)
  }, [])

  useEffect(() => {
    if (session?.user.id) {
      void loadClinic(session.user.id)
    } else {
      setClinic(null)
      setTickets([])
    }
  }, [session?.user.id, loadClinic])

  // 現在のセッションのチケット一覧取得
  const loadTickets = useCallback(async (targetClinic: Clinic) => {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('clinic_id', targetClinic.id)
      .eq('session_id', targetClinic.current_session_id)
      .order('ticket_number', { ascending: true })

    if (error) {
      setErrorMsg(error.message)
      return
    }
    setTickets((data ?? []) as Ticket[])
  }, [])

  useEffect(() => {
    if (!clinic) return
    void loadTickets(clinic)

    const channel = supabase
      .channel(`admin-tickets-${clinic.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `clinic_id=eq.${clinic.id}`,
        },
        () => {
          void loadTickets(clinic)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [clinic, loadTickets])

  // 患者用固定URLのQRコード生成
  const patientUrl = clinic ? `${window.location.origin}/c/${clinic.slug}` : ''

  useEffect(() => {
    if (!patientUrl) {
      setQrDataUrl('')
      return
    }
    QRCode.toDataURL(patientUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [patientUrl])

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    setAuthMessage(null)
    setBusy(true)
    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setAuthError(error.message)
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) {
          setAuthError(error.message)
        } else {
          setAuthMessage('登録しました。確認メールが届いた場合はリンクを開いてからログインしてください。')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const handleCreateClinic = async (e: FormEvent) => {
    e.preventDefault()
    if (!session) return
    setSetupError(null)
    const slug = newClinicSlug.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
      setSetupError('URLスラッグは半角英小文字・数字・ハイフン（3〜50文字）で入力してください。')
      return
    }
    setBusy(true)
    const { data, error } = await supabase
      .from('clinics')
      .insert({
        owner_user_id: session.user.id,
        name: newClinicName.trim(),
        slug,
      })
      .select('*')
      .single<Clinic>()
    setBusy(false)

    if (error) {
      setSetupError(
        error.code === '23505'
          ? 'このURLスラッグはすでに使用されています。別の文字列を入力してください。'
          : error.message,
      )
      return
    }
    setClinic(data)
  }

  const handleIssueTicket = async () => {
    if (!clinic) return
    setBusy(true)
    setErrorMsg(null)
    const { data, error } = await supabase.rpc('issue_ticket', {
      p_clinic_id: clinic.id,
    })
    setBusy(false)

    if (error) {
      setErrorMsg(error.message)
      return
    }
    const issued = data as Ticket
    setLatestIssued(issued)
    await loadTickets(clinic)
  }

  const handleUpdateStatus = async (ticket: Ticket, nextStatus: TicketStatus) => {
    setErrorMsg(null)
    const patch: Partial<Ticket> = { status: nextStatus }
    if (nextStatus === 'calling') patch.called_at = new Date().toISOString()
    if (nextStatus === 'done' || nextStatus === 'cancelled') {
      patch.completed_at = new Date().toISOString()
    }
    const { error } = await supabase
      .from('tickets')
      .update(patch)
      .eq('id', ticket.id)

    if (error) {
      setErrorMsg(error.message)
      return
    }
    if (clinic) await loadTickets(clinic)
  }

  const handleResetSession = async () => {
    if (!clinic) return
    const ok = window.confirm(
      '受付番号を「1番」にリセットしますか？（午前・午後の切り替えなど）※これまでの番号は無効になり、次の発券から1番になります。',
    )
    if (!ok) return

    setBusy(true)
    setErrorMsg(null)
    const { data, error } = await supabase.rpc('reset_queue_session', {
      p_clinic_id: clinic.id,
    })
    setBusy(false)

    if (error) {
      setErrorMsg(error.message)
      return
    }
    const nextSessionId = data as number
    setLatestIssued(null)
    setClinic({ ...clinic, current_session_id: nextSessionId })
  }

  const handleCopyUrl = async () => {
    if (!patientUrl) return
    await navigator.clipboard.writeText(patientUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="container narrow">
        <section className="card">
          <h1>Supabase の環境変数が未設定です</h1>
          <p className="muted">
            <code>.env.local</code> に <code>VITE_SUPABASE_URL</code> と{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> を設定してから再起動してください。
          </p>
        </section>
      </main>
    )
  }

  if (authLoading) {
    return (
      <main className="container narrow">
        <p className="muted center">読み込み中...</p>
      </main>
    )
  }

  // 未ログイン: Supabase Auth ログイン・新規登録画面
  if (!session) {
    return (
      <main className="container narrow">
        <section className="card">
          <div className="row-between">
            <h1>病院スタッフ ログイン</h1>
            <button type="button" className="btn btn-text" onClick={() => onNavigate('/')}>
              トップへ
            </button>
          </div>

          <div className="tabs">
            <button
              type="button"
              className={`tab ${authMode === 'login' ? 'active' : ''}`}
              onClick={() => setAuthMode('login')}
            >
              ログイン
            </button>
            <button
              type="button"
              className={`tab ${authMode === 'signup' ? 'active' : ''}`}
              onClick={() => setAuthMode('signup')}
            >
              新規クリニック登録
            </button>
          </div>

          <form className="form-stack" onSubmit={handleAuthSubmit}>
            <label>
              メールアドレス
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@clinic.example.com"
              />
            </label>
            <label>
              パスワード（6文字以上）
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {authError && <p className="alert alert-error">{authError}</p>}
            {authMessage && <p className="alert alert-info">{authMessage}</p>}
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {authMode === 'login' ? 'ログイン' : 'アカウントを作成'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  if (clinicLoading) {
    return (
      <main className="container narrow">
        <p className="muted center">クリニック情報を読み込み中...</p>
      </main>
    )
  }

  // 初回ログイン時: クリニック名とURLスラッグの登録
  if (!clinic) {
    return (
      <main className="container narrow">
        <section className="card">
          <div className="row-between">
            <h1>クリニック初期設定</h1>
            <button
              type="button"
              className="btn btn-text"
              onClick={() => void supabase.auth.signOut()}
            >
              ログアウト
            </button>
          </div>
          <p className="muted small">
            クリニック名と患者様用の固定URL（スラッグ）を設定すると、管理画面とQRコードが発行されます。
          </p>
          <form className="form-stack" onSubmit={handleCreateClinic}>
            <label>
              クリニック名
              <input
                type="text"
                required
                value={newClinicName}
                onChange={(e) => setNewClinicName(e.target.value)}
                placeholder="例: さくら内科クリニック"
              />
            </label>
            <label>
              患者様用URLスラッグ（半角英小文字・数字・ハイフン）
              <input
                type="text"
                required
                value={newClinicSlug}
                onChange={(e) => setNewClinicSlug(e.target.value)}
                placeholder="例: sakura-naika"
              />
              <span className="hint">
                発行されるURL: {window.location.origin}/c/{newClinicSlug || 'sakura-naika'}
              </span>
            </label>
            {setupError && <p className="alert alert-error">{setupError}</p>}
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              クリニックを作成して開始
            </button>
          </form>
        </section>
      </main>
    )
  }

  const waitingTickets = tickets.filter((t) => t.status === 'waiting')
  const callingTickets = tickets.filter((t) => t.status === 'calling')
  const currentCallingNumber =
    callingTickets.length > 0 ? callingTickets[callingTickets.length - 1].ticket_number : null
  const visibleTickets =
    filter === 'active'
      ? tickets.filter((t) => t.status === 'waiting' || t.status === 'calling')
      : tickets

  return (
    <main className="container">
      <header className="admin-header">
        <div>
          <p className="badge">管理画面 / 第 {clinic.current_session_id} 回</p>
          <h1>{clinic.name}</h1>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-danger-outline"
            onClick={handleResetSession}
            disabled={busy}
          >
            番号を1番にリセット
          </button>
          <button
            type="button"
            className="btn btn-text"
            onClick={() => void supabase.auth.signOut()}
          >
            ログアウト
          </button>
        </div>
      </header>

      {errorMsg && <p className="alert alert-error">{errorMsg}</p>}

      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">現在呼び出し中</span>
          <strong className="kpi-value">
            {currentCallingNumber !== null ? `${currentCallingNumber} 番` : '—'}
          </strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">待機中の人数</span>
          <strong className="kpi-value">{waitingTickets.length} 人</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">本日の発券数（今回の回）</span>
          <strong className="kpi-value">{tickets.length} 件</strong>
        </div>
      </section>

      <div className="admin-layout">
        <section className="card">
          <div className="row-between">
            <h2>受付・順番管理</h2>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={handleIssueTicket}
              disabled={busy}
            >
              ＋ 新しい番号を発券
            </button>
          </div>

          {latestIssued && (
            <div className="issued-banner">
              <div>
                <span className="issued-label">発券完了（患者様にお伝えください）</span>
                <div className="issued-numbers">
                  <span>
                    受付番号: <strong>{latestIssued.ticket_number} 番</strong>
                  </span>
                  <span>
                    パスワード(PIN): <strong className="mono">{latestIssued.passcode}</strong>
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-text"
                onClick={() => setLatestIssued(null)}
              >
                閉じる
              </button>
            </div>
          )}

          <div className="tabs small-tabs">
            <button
              type="button"
              className={`tab ${filter === 'active' ? 'active' : ''}`}
              onClick={() => setFilter('active')}
            >
              待機・呼び出し中 ({waitingTickets.length + callingTickets.length})
            </button>
            <button
              type="button"
              className={`tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              すべて ({tickets.length})
            </button>
          </div>

          {visibleTickets.length === 0 ? (
            <p className="muted empty-state">表示する受付番号がありません。</p>
          ) : (
            <div className="ticket-list">
              {visibleTickets.map((ticket) => (
                <div key={ticket.id} className={`ticket-row status-${ticket.status}`}>
                  <div className="ticket-main">
                    <span className="ticket-num">{ticket.ticket_number} 番</span>
                    <span className="ticket-pin mono">PIN: {ticket.passcode}</span>
                    <span className={`status-pill pill-${ticket.status}`}>
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </div>
                  <div className="ticket-actions">
                    {ticket.status === 'waiting' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void handleUpdateStatus(ticket, 'calling')}
                      >
                        呼び出す
                      </button>
                    )}
                    {ticket.status === 'calling' && (
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        onClick={() => void handleUpdateStatus(ticket, 'done')}
                      >
                        診察完了
                      </button>
                    )}
                    {(ticket.status === 'waiting' || ticket.status === 'calling') && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void handleUpdateStatus(ticket, 'cancelled')}
                      >
                        キャンセル
                      </button>
                    )}
                    {(ticket.status === 'done' || ticket.status === 'cancelled') && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void handleUpdateStatus(ticket, 'waiting')}
                      >
                        待機に戻す
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="card qr-card">
          <h2>患者様用 固定URL・QRコード</h2>
          <p className="muted small">
            受付に掲示してお使いください。患者様はスマホで読み取り、番号と4桁PINを入力して待ち人数を確認できます。
          </p>
          {qrDataUrl && (
            <div className="qr-box">
              <img src={qrDataUrl} alt={`${clinic.name} の患者様用QRコード`} />
            </div>
          )}
          <div className="url-box">
            <code>{patientUrl}</code>
          </div>
          <div className="action-stack">
            <button type="button" className="btn btn-secondary" onClick={handleCopyUrl}>
              {copied ? 'URLをコピーしました' : 'URLをコピー'}
            </button>
            {qrDataUrl && (
              <a
                href={qrDataUrl}
                download={`qr-${clinic.slug}.png`}
                className="btn btn-secondary"
              >
                QR画像を保存 (PNG)
              </a>
            )}
            <button
              type="button"
              className="btn btn-text"
              onClick={() => onNavigate(`/c/${clinic.slug}`)}
            >
              患者画面をプレビュー →
            </button>
          </div>
        </aside>
      </div>
    </main>
  )
}
