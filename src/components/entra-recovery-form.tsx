/** Delegated Entra recovery. No credentials enter this form. */
export function EntraRecoveryForm() {
  return (
    <div>
      <p>Complete account recovery on the secure sign-in page.</p>
      <ol>
        <li>Continue to the sign-in page and enter your account email.</li>
        <li>
          Select <strong>Forgot password?</strong> on the password screen.
        </li>
        <li>Complete verification and follow the password instructions.</li>
      </ol>
      <p className="small">
        After verification, your previous sessions for this application end.
        Administrators still complete authenticator verification.
      </p>
      <form action="/auth/entra/recover" method="post">
        <button className="button button-dark" type="submit">
          Continue to secure recovery
        </button>
      </form>
    </div>
  );
}
