/** Native navigation lets the browser complete provider sign-out after local revocation. */
export function EntraLogoutForm() {
  return (
    <form action="/auth/entra/logout" method="post">
      <button className="button button-outline" type="submit">
        Sign out
      </button>
    </form>
  );
}
