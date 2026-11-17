import Link from "next/link";
export default function NotFound() {
  return (
    <section className="container section">
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1>Let’s find your way.</h1>
      <p className="intro-copy">This page is not available.</p>
      <Link className="button button-dark" href="/">
        Back to home
      </Link>
    </section>
  );
}
