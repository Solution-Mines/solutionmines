"use client";

import { useActionState, useId, useMemo } from "react";
import { useFormStatus } from "react-dom";
import { submitEnquiry } from "@/app/(marketing)/contact/actions";
import {
  SERVICE_OPTIONS,
  TIMELINE_OPTIONS,
  type ContactState,
} from "@/lib/validation/contact";

const initial: ContactState = { status: "idle" };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn--solid"
      /* min-width locked so the label -> spinner swap cannot resize the
         button, which would be a visible layout shift at the moment of
         highest user attention. */
      style={{ minWidth: "12rem", justifyContent: "center" }}
      aria-busy={pending}
      disabled={pending}
    >
      <span>{pending ? "Sending…" : "Send enquiry"}</span>
      {!pending && <span className="btn__arrow" aria-hidden="true">&rarr;</span>}
    </button>
  );
}

export function ContactForm() {
  const [state, action] = useActionState(submitEnquiry, initial);
  const id = useId();
  // Stable across re-renders; feeds the server-side time trap.
  const renderedAt = useMemo(() => Date.now(), []);

  const err = state.fieldErrors ?? {};
  const val = state.values ?? {};
  const field = (name: string) => `${id}-${name}`;

  return (
    <form action={action} noValidate className="form">
      {state.status === "error" && state.message && (
        <div className="form__banner" role="alert">
          {state.message}
        </div>
      )}

      <div className="form__row">
        <div className="field">
          <label htmlFor={field("name")} className="field__label">
            Name <span aria-hidden="true">*</span>
            <span className="u-sr-only">(required)</span>
          </label>
          <input
            id={field("name")}
            name="name"
            type="text"
            autoComplete="name"
            defaultValue={val.name}
            required
            aria-invalid={err.name ? true : undefined}
            aria-describedby={err.name ? field("name-err") : undefined}
            className="field__input"
          />
          {err.name && (
            <p id={field("name-err")} className="field__error" role="alert">
              {err.name}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={field("email")} className="field__label">
            Work email <span aria-hidden="true">*</span>
            <span className="u-sr-only">(required)</span>
          </label>
          <input
            id={field("email")}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            defaultValue={val.email}
            required
            aria-invalid={err.email ? true : undefined}
            aria-describedby={`${err.email ? `${field("email-err")} ` : ""}${field("email-hint")}`}
            className="field__input"
          />
          <p id={field("email-hint")} className="field__hint">
            We reply to this address. No newsletter.
          </p>
          {err.email && (
            <p id={field("email-err")} className="field__error" role="alert">
              {err.email}
            </p>
          )}
        </div>
      </div>

      <div className="form__row">
        <div className="field">
          <label htmlFor={field("company")} className="field__label">Company</label>
          <input
            id={field("company")}
            name="company"
            type="text"
            autoComplete="organization"
            defaultValue={val.company}
            className="field__input"
          />
        </div>

        <div className="field">
          <label htmlFor={field("service")} className="field__label">What do you need?</label>
          <select
            id={field("service")}
            name="service"
            defaultValue={val.service || SERVICE_OPTIONS[0]}
            className="field__input"
          >
            {SERVICE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor={field("message")} className="field__label">
          What are you building, or what is broken? <span aria-hidden="true">*</span>
          <span className="u-sr-only">(required)</span>
        </label>
        <textarea
          id={field("message")}
          name="message"
          rows={6}
          defaultValue={val.message}
          required
          aria-invalid={err.message ? true : undefined}
          aria-describedby={`${err.message ? `${field("message-err")} ` : ""}${field("message-hint")}`}
          className="field__input"
        />
        <p id={field("message-hint")} className="field__hint">
          A couple of sentences is plenty. The more specific, the more useful
          our reply will be.
        </p>
        {err.message && (
          <p id={field("message-err")} className="field__error" role="alert">
            {err.message}
          </p>
        )}
      </div>

      <fieldset className="field">
        <legend className="field__label">Timeline</legend>
        <div className="radios">
          {TIMELINE_OPTIONS.map((t) => (
            <label key={t} className="radio">
              <input
                type="radio"
                name="timeline"
                value={t}
                defaultChecked={val.timeline === t}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="checkbox">
          <input
            type="checkbox"
            name="consent"
            defaultChecked={false}
            aria-invalid={err.consent ? true : undefined}
            aria-describedby={err.consent ? field("consent-err") : undefined}
          />
          <span>
            I am happy for SolutionMines to use these details to respond to this
            enquiry.
          </span>
        </label>
        {err.consent && (
          <p id={field("consent-err")} className="field__error" role="alert">
            {err.consent}
          </p>
        )}
      </div>

      {/* Honeypot. Off-screen rather than display:none — some bots skip
          hidden fields, and this stays out of the tab order either way. */}
      <div aria-hidden="true" className="honeypot">
        <label htmlFor={field("website")}>Website (leave this empty)</label>
        <input id={field("website")} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="renderedAt" value={renderedAt} />

      <Submit />
    </form>
  );
}
