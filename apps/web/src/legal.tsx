import { type ReactNode } from "react";
import { assetPath } from "./data/league.js";

// Static legal pages, rendered as standalone full-page views when the URL carries
// `?page=privacy`, `?page=terms`, or `?page=rules` (same query-param routing as
// `?reset=` / `?verify=`). Reachable logged-out and logged-in. Copy is fixed and
// verbatim.

export type LegalPageKind = "privacy" | "terms" | "rules";

const SUPPORT_EMAIL = "support@playmassalia.com";

function SupportLink() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}

function LegalFrame({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <main className="landing-shell legal-shell">
      <header className="legal-header">
        <button className="brand-lockup" type="button" onClick={onBack}>
          <span className="brand-mark" aria-hidden="true">
            <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
          </span>
          <span>MASSALIA</span>
        </button>
        <button className="legal-back" type="button" onClick={onBack}>← Back</button>
      </header>
      <article className="legal-article">
        <h1>{title}</h1>
        {subtitle ? <p className="legal-updated">{subtitle}</p> : null}
        {children}
      </article>
    </main>
  );
}

export function PrivacyPolicy({ onBack }: { onBack: () => void }) {
  return (
    <LegalFrame title="Privacy Policy" subtitle="Last updated: 28 August 2026" onBack={onBack}>
      <p>{`MASSALIA ("the game") is a browser game operated as an independent project. This policy explains what data we collect and why, in plain language.`}</p>
      <p>
        <strong>What we collect.</strong>
        {` When you register: your email address, a securely hashed version of your password (we never store the password itself), and your newsletter preference. While you play: your game actions and progress (characters, holdings, messages to other players' characters, and similar), session tokens to keep you logged in, and your IP address, used transiently for rate limiting and abuse prevention.`}
      </p>
      <p>
        <strong>Analytics.</strong>
        {` We use Plausible Analytics, a privacy-focused, EU-hosted service, to measure aggregate site usage (pages visited, referral sources, country, device type). It uses no cookies and collects no personal identifiers.`}
      </p>
      <p>
        <strong>What we don't do.</strong>
        {` We don't run ads. We don't use advertising cookies or invasive trackers. We don't sell or share your data with anyone for marketing. The only cookie we set is the session cookie that keeps you logged in.`}
      </p>
      <p>
        <strong>Where it lives.</strong>
        {` Game data is hosted on Railway and the website is served via GitHub Pages; transactional email (such as password resets) is sent via Resend from EU infrastructure, and aggregate analytics are processed by Plausible on EU infrastructure. These providers may process some data on servers outside the EU, including in the United States, under their own compliance frameworks.`}
      </p>
      <p>
        <strong>How long we keep it.</strong>
        {` Your account data is kept while your account exists. Sessions expire after 30 days. Password-reset and verification links expire within hours and are single-use.`}
      </p>
      <p>
        <strong>Your rights.</strong>
        {` You can access the data you've given us by asking, correct your email by contacting us, and delete your account yourself at any time from the game's settings. Deletion is immediate and irreversible: your email and credentials are permanently scrubbed, and your former characters remain in the game world only as anonymized historical records with no link to you.`}
      </p>
      <p>
        <strong>Age.</strong>
        {` The game is intended for players aged 16 and over.`}
      </p>
      <p>
        <strong>Contact.</strong>
        {` For any privacy question or request: `}
        <SupportLink />
        {`.`}
      </p>
      <p>{`If this policy changes materially, we'll note it on this page and update the date above.`}</p>
    </LegalFrame>
  );
}

export function TermsOfService({ onBack }: { onBack: () => void }) {
  return (
    <LegalFrame title="Terms of Service" subtitle="Last updated: 28 August 2026" onBack={onBack}>
      <p>{`Welcome to MASSALIA. By creating an account you agree to these terms.`}</p>
      <p>
        <strong>The game.</strong>
        {` MASSALIA is a multiplayer strategy game provided as-is, free of charge, as an independent project. Features may change, break, be rebalanced, or be removed. Game progress, items, and currencies have no real-world value. We may need to reset, wipe, or restructure game worlds during development.`}
      </p>
      <p>
        <strong>Your account.</strong>
        {` You must be at least 16 years old. Keep your credentials to yourself; you're responsible for activity on your account. One account per person. Provide an email you control — it's the only way to recover your account.`}
      </p>
      <p>
        <strong>Conduct.</strong>
        {` The game includes political intrigue between characters — scheming in-game is the point. Directed at real people, it isn't: no harassment, hate speech, threats, or targeting of players rather than their characters. No cheating, exploiting bugs (report them instead), automation/botting, or attempts to break or overload the service.`}
      </p>
      <p>
        <strong>Enforcement.</strong>
        {` We may warn, suspend, or terminate accounts that break these rules, and remove content that violates them. Serious or repeated violations mean permanent removal.`}
      </p>
      <p>
        <strong>Liability.</strong>
        {` The game is provided without warranties of any kind. To the extent permitted by law, we're not liable for loss of game progress, downtime, or any indirect damages. The service may be discontinued; if that ever happens we'll give reasonable notice.`}
      </p>
      <p>
        <strong>Changes.</strong>
        {` We may update these terms; material changes will be noted on this page. Continuing to play after changes means you accept them.`}
      </p>
      <p>
        <strong>Contact.</strong>
        {` `}
        <SupportLink />
        {`.`}
      </p>
    </LegalFrame>
  );
}

export function GameRules({ onBack }: { onBack: () => void }) {
  return (
    <LegalFrame title="Game rules" onBack={onBack}>
      <ol className="legal-rules">
        <li>
          <strong>One character per world.</strong>
          {` Each player may own and play only one character per game world.`}
        </li>
        <li>
          <strong>Play for your own benefit.</strong>
          {` A character must always be played for its own benefit, or for the benefit of its House or party. Characters that exist to serve a character outside their own House or party may be permanently banned and deleted. Characters that knowingly profit from such feeder characters may be severely punished.`}
        </li>
        <li>
          <strong>No voting multis.</strong>
          {` Characters created to influence votes, elections, or chamber seats will be banned.`}
        </li>
      </ol>
      <p>{`Breaking these rules can lead to warnings, loss of assets, or permanent deletion of the character, at the discretion of the game staff.`}</p>
    </LegalFrame>
  );
}

export function LegalPage({ page, onBack }: { page: LegalPageKind; onBack: () => void }) {
  if (page === "privacy") return <PrivacyPolicy onBack={onBack} />;
  if (page === "rules") return <GameRules onBack={onBack} />;
  return <TermsOfService onBack={onBack} />;
}
