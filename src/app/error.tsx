"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="container section">
      <h1>Something went wrong.</h1>
      <p className="intro-copy">
        Please try again. If this continues, contact support.
      </p>
      <button className="button button-dark" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
