export const siteConfig = {
  name: "NOVA CAPITAL",
  monogram: "N",
  assistantName: "Maya",
  logoPath: "", // Optional local public asset path, e.g. /brand.svg.
  description:
    "A clearer view of your investments. Private reporting across stocks, forex, commodities and crypto.",
  contactEmail: "", // Set a verified company support address before launch.
  phone: "",
  address: "",
  // Verified public HTTPS profile URLs only. Empty means no social links are shown.
  socialLinks: [] as { label: string; href: string }[],
  navigation: [
    { label: "Home", href: "/" },
    { label: "About", href: "/about" },
    { label: "Services", href: "/services" },
    { label: "Markets", href: "/markets" },
    { label: "Benefits", href: "/benefits" },
    { label: "Education", href: "/education" },
    { label: "FAQ", href: "/faq" },
    { label: "Contact", href: "/contact" },
  ],
  legalLinks: [
    { label: "Privacy", href: "/legal/privacy" },
    { label: "Terms", href: "/legal/terms" },
    { label: "Risk disclosure", href: "/legal/risk" },
  ],
};
export const faqGuidance = [
  {
    question: "Where are my funds held?",
    answer:
      "Your funds remain in your own broker account. This website does not collect or custody client investment deposits.",
  },
  {
    question: "How is portfolio information updated?",
    answer:
      "An administrator manually records portfolio values and dated snapshots. Each update shows its reporting date; information is not a live broker feed.",
  },
  {
    question: "How do I access my account?",
    answer:
      "Access is by invitation. Once invited, set your password using the secure email link, then use Client Login. Existing clients can request a password reset.",
  },
  {
    question: "Are returns guaranteed?",
    answer:
      "No. All investments involve risk, including possible loss of capital. Past reported results do not guarantee future performance.",
  },
  {
    question: "Where can I find my reports?",
    answer:
      "Sign in to your client portal and open Reports. Only reports assigned to your account are available to you.",
  },
];

// These topics remain available as accurate support guidance, but are not public FAQ prompts.
export const faqs = faqGuidance.filter((_, index) => ![1, 3].includes(index));
