import { useEffect, useState } from "react";
import { api, type NewsEntry } from "../api.js";
import { LobbyFrame, LobbySectionHeading } from "./LobbyFrame.js";

// /news — public, no login. Every entry of the news file (content/news/news.json,
// served statically), newest first; a failed fetch shows the empty line.

// News dates are calendar days (YYYY-MM-DD), not instants: format them in UTC so
// the day never shifts with the viewer's timezone.
function newsDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function NewsPage() {
  // undefined = loading; null = the file could not be fetched.
  const [news, setNews] = useState<NewsEntry[] | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    api
      .news()
      .then((entries) => {
        if (active) setNews(entries);
      })
      .catch(() => {
        if (active) setNews(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <LobbyFrame active="news">
      <div className="lobby-page">
        <section className="lobby-section" aria-labelledby="lobby-news-title">
          <LobbySectionHeading id="lobby-news-title" eyebrow="News" title="Dispatches" />
          {news === undefined ? (
            <p className="lobby-quiet" role="status" aria-busy="true">Fetching the dispatches…</p>
          ) : news && news.length ? (
            <div className="lobby-news">
              {news.map((entry) => (
                <article className="lobby-news-item" key={entry.id}>
                  <p className="lobby-news-meta">
                    <time dateTime={entry.date}>{newsDate(entry.date)}</time>
                    <span className={`lobby-tag lobby-tag-${entry.tag}`}>{entry.tag}</span>
                  </p>
                  <h3>{entry.title}</h3>
                  {entry.body.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </article>
              ))}
            </div>
          ) : (
            <p className="lobby-empty">Nothing posted yet.</p>
          )}
        </section>
      </div>
    </LobbyFrame>
  );
}
