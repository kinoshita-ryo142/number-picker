import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase.ts'
import { playCallChime } from '../lib/sound.ts'
import type { ClinicQueueState, VerifiedTicketStatus } from '../types/queue.ts'

interface PatientPageProps {
  slug: string
}

interface StoredCredentials {
  ticketNumber: number
  passcode: string
}

export function PatientPage({ slug }: PatientPageProps) {
  const storageKey = `clinic-ticket:${slug}`

  const [clinicInfo, setClinicInfo] = useState<ClinicQueueState | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadingClinic, setLoadingClinic] = useState(true)

  const [ticketInput, setTicketInput] = useState('')
  const [passcodeInput, setPasscodeInput] = useState('')
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null)

  const [verified, setVerified] = useState<VerifiedTicketStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(false)

  const prevStatusRef = useRef<string | null>(null)

  // クリニック公開情報の取得
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoadingClinic(false)
      return
    }
    setLoadingClinic(true)
    supabase
      .from('clinic_queue_state')
      .select('*')
      .eq('slug', slug.toLowerCase())
      .maybeSingle<ClinicQueueState>()
      .then(({ data, error }) => {
        if (error || !data) {
          setNotFound(true)
        } else {
          setClinicInfo(data)
          setNotFound(false)
        }
        setLoadingClinic(false)
      })
  }, [slug])

  // 番号＋4桁PINで照合RPCを実行
  const verifyTicket = useCallback(
    async (creds: StoredCredentials, silent = false) => {
      if (!silent) {
        setChecking(true)
        setErrorMsg(null)
      }
      const { data, error } = await supabase.rpc('verify_ticket', {
        p_slug: slug,
        p_ticket_number: creds.ticketNumber,
        p_passcode: creds.passcode,
      })

      if (!silent) setChecking(false)

      if (error) {
        setErrorMsg('照合中にエラーが発生しました。通信状況をご確認ください。')
        return
      }

      const rows = (data ?? []) as VerifiedTicketStatus[]
      if (rows.length === 0) {
        if (silent) {
          // 受付リセット等でセッションが切り替わった場合
          setVerified(null)
          setCredentials(null)
          sessionStorage.removeItem(storageKey)
          setErrorMsg('受付番号が無効になったか、新しい受付回に切り替わりました。')
        } else {
          setErrorMsg('番号または4桁パスワードが正しくありません。受付票をご確認ください。')
        }
        return
      }

      const next = rows[0]
      if (soundEnabled && prevStatusRef.current === 'waiting' && next.status === 'calling') {
        playCallChime()
      }
      prevStatusRef.current = next.status
      setVerified(next)
      setCredentials(creds)
      sessionStorage.setItem(storageKey, JSON.stringify(creds))
    },
    [slug, soundEnabled, storageKey],
  )

  // リロード時も sessionStorage から自動復元
  useEffect(() => {
    if (!clinicInfo) return
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as StoredCredentials
      if (parsed.ticketNumber && parsed.passcode) {
        setTicketInput(String(parsed.ticketNumber))
        setPasscodeInput(parsed.passcode)
        void verifyTicket(parsed, true)
      }
    } catch {
      sessionStorage.removeItem(storageKey)
    }
  }, [clinicInfo, storageKey, verifyTicket])

  // Supabase Realtime で clinic_queue_state の更新を購読し、自動再照合
  useEffect(() => {
    if (!clinicInfo || !credentials) return

    const channel = supabase
      .channel(`patient-queue-${clinicInfo.clinic_id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'clinic_queue_state',
          filter: `clinic_id=eq.${clinicInfo.clinic_id}`,
        },
        () => {
          void verifyTicket(credentials, true)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [clinicInfo, credentials, verifyTicket])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const num = Number.parseInt(ticketInput, 10)
    const pin = passcodeInput.trim()
    if (!Number.isInteger(num) || num < 1) {
      setErrorMsg('有効な受付番号を入力してください。')
      return
    }
    if (!/^[0-9]{4}$/.test(pin)) {
      setErrorMsg('パスワードは数字4桁で入力してください。')
      return
    }
    await verifyTicket({ ticketNumber: num, passcode: pin }, false)
  }

  const handleClear = () => {
    setVerified(null)
    setCredentials(null)
    prevStatusRef.current = null
    sessionStorage.removeItem(storageKey)
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="container narrow">
        <section className="card">
          <h1>設定エラー</h1>
          <p className="muted">接続設定が完了していません。クリニックスタッフへお知らせください。</p>
        </section>
      </main>
    )
  }

  if (loadingClinic) {
    return (
      <main className="container narrow">
        <p className="muted center">読み込み中...</p>
      </main>
    )
  }

  if (notFound || !clinicInfo) {
    return (
      <main className="container narrow">
        <section className="card">
          <h1>クリニックが見つかりません</h1>
          <p className="muted">URLが正しいか、受付のQRコードをもう一度ご確認ください。</p>
        </section>
      </main>
    )
  }

  return (
    <main className="container narrow">
      <section className="card patient-header">
        <p className="badge">順番待ち確認</p>
        <h1>{clinicInfo.clinic_name}</h1>
        <p className="muted small">画面を開いたままにしておくと自動で最新状態に更新されます。</p>
      </section>

      {!verified ? (
        <section className="card">
          <h2>受付番号とパスワードを入力</h2>
          <form className="form-stack" onSubmit={handleSubmit}>
            <label>
              受付番号
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                placeholder="例: 12"
                value={ticketInput}
                onChange={(e) => setTicketInput(e.target.value)}
              />
            </label>
            <label>
              パスワード（数字4桁）
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                required
                placeholder="例: 4821"
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
              />
            </label>
            {errorMsg && <p className="alert alert-error">{errorMsg}</p>}
            <button type="submit" className="btn btn-primary btn-lg" disabled={checking}>
              {checking ? '確認中...' : '待ち人数を確認する'}
            </button>
          </form>
        </section>
      ) : (
        <section className={`card status-card status-card-${verified.status}`}>
          <div className="row-between">
            <span className="muted">あなたの受付番号</span>
            <strong className="my-number">{verified.ticket_number} 番</strong>
          </div>

          {verified.status === 'waiting' && (
            <div className="wait-hero">
              {verified.ahead_count === 0 ? (
                <>
                  <p className="wait-emphasis">まもなく順番です</p>
                  <p className="muted">待合室の近くでお待ちください。</p>
                </>
              ) : (
                <>
                  <p className="wait-label">あなたの前に待っている人数</p>
                  <p className="wait-count">
                    あと <strong>{verified.ahead_count}</strong> 人
                  </p>
                </>
              )}
            </div>
          )}

          {verified.status === 'calling' && (
            <div className="wait-hero calling">
              <p className="wait-emphasis">お呼び出し中です！</p>
              <p>診察室・受付までお越しください。</p>
            </div>
          )}

          {verified.status === 'done' && (
            <div className="wait-hero">
              <p className="wait-emphasis">診察が完了しました</p>
              <p className="muted">ご来院ありがとうございました。</p>
            </div>
          )}

          {verified.status === 'cancelled' && (
            <div className="wait-hero">
              <p className="wait-emphasis">キャンセルされました</p>
              <p className="muted">ご不明な点は受付スタッフまでお声がけください。</p>
            </div>
          )}

          <dl className="meta-list">
            <div>
              <dt>現在呼び出し中</dt>
              <dd>{verified.current_number !== null ? `${verified.current_number} 番` : '準備中'}</dd>
            </div>
            <div>
              <dt>最終更新</dt>
              <dd>{new Date(verified.updated_at).toLocaleTimeString('ja-JP')}</dd>
            </div>
          </dl>

          <div className="patient-footer">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => {
                  setSoundEnabled(e.target.checked)
                  if (e.target.checked) playCallChime()
                }}
              />
              <span>呼び出し時に音でお知らせする（テスト音が鳴ります）</span>
            </label>
            <button type="button" className="btn btn-text" onClick={handleClear}>
              別の番号で確認する
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
