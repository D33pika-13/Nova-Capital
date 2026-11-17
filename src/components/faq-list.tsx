import { faqs } from "@/lib/site-config";
export function FaqList() {
  return (
    <div>
      {faqs.map((faq) => (
        <details className="faq" key={faq.question}>
          <summary>
            {faq.question}
            <span aria-hidden="true">+</span>
          </summary>
          <p>{faq.answer}</p>
        </details>
      ))}
    </div>
  );
}
