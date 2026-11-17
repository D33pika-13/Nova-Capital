export function EntraLoginForm() {
  return (
    <form action="/auth/entra/start" method="post">
      <button className="button button-dark" type="submit">
        Continue to secure sign-in
      </button>
    </form>
  );
}
