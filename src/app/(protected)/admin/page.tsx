import Link from "next/link";

export default function AdminLandingPage() {
  return (
    <section className="stack">
      <header>
        <p className="eyebrow">Admin</p>
        <h2>Identity & Access</h2>
      </header>

      <div className="grid cols-2">
        <article className="card stack">
          <h3>Users</h3>
          <p className="muted">Browse user accounts, check memberships, and inspect issued tokens.</p>
          <Link className="link-chip" href="/admin/users">
            Open users
          </Link>
        </article>

        <article className="card stack">
          <h3>Groups</h3>
          <p className="muted">Review groups, manage memberships, and track authorization boundaries.</p>
          <Link className="link-chip" href="/admin/groups">
            Open groups
          </Link>
        </article>
      </div>
    </section>
  );
}
