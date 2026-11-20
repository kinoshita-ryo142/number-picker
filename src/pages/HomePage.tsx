import { useState } from 'react'
import type { FormEvent } from 'react'

interface HomePageProps {
  onNavigate: (path: string) => void
}

export function HomePage({ onNavigate }: HomePageProps) {
  const [slug, setSlug] = useState('')

  const handleOpenClinic = (e: FormEvent) => {
    e.preventDefault()
    const cleaned = slug.trim().toLowerCase()
    if (!cleaned) return
    onNavigate(`/c/${cleaned}`)
  }

  return (
    <main className="container narrow">
      <section className="card hero-card">
        <p className="badge">クリニック向け 順番待ちアプリ</p>
        <h1>順番待ち確認システム</h1>
        <p className="muted">
          病院スタッフは管理画面から番号と4桁PINを発行し、患者様はスマートフォンから現在の待ち人数をリアルタイムで確認できます。
        </p>

        <div className="action-stack">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => onNavigate('/admin')}
          >
            病院スタッフ用 管理画面へ
          </button>
        </div>
      </section>

      <section className="card">
        <h2>患者様用 閲覧ページを開く</h2>
        <p className="muted small">
          受付のQRコードから直接アクセスするか、クリニックIDを入力してください。
        </p>
        <form className="inline-form" onSubmit={handleOpenClinic}>
          <input
            type="text"
            placeholder="例: sakura-clinic"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            aria-label="クリニックID"
          />
          <button type="submit" className="btn btn-secondary">
            開く
          </button>
        </form>
      </section>
    </main>
  )
}
