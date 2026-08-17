import { DocumentHeader, Section } from '../../components/ui/document';

/**
 * THE ACCESSIBILITY STATEMENT.
 *
 * EU institutions operate under EN 301 549; UN bodies and most donor-funded programmes have
 * comparable requirements, and procurement processes look for this page by name. Publishing
 * it is both correct and, bluntly, an advantage.
 *
 * It is written honestly, including the parts that are not done. A statement claiming full
 * conformance is not credible to anybody who has ever audited one, and a known limitation
 * declared in advance is a much smaller problem than the same limitation discovered.
 *
 * **Update the "known limitations" list when the underlying screens change.** A stale
 * accessibility statement is worse than none: it is a documented claim that has stopped
 * being true.
 */
export function AccessibilityPage() {
  return (
    <article className="mx-auto max-w-[680px]">
      <DocumentHeader
        title="Accessibility statement"
        district="Rotaract District 9218"
        office="District Information System"
        status="Final"
      />

      <div className="flex flex-col gap-8">
        <Section number="1." title="Commitment" id="commitment">
          <p className="prose">
            This system is used by club officers across Uganda on a wide range of devices and
            connections, and by district officers, assessors and partners who may rely on assistive
            technology. It is built to be operable by everybody who holds a position in the
            district, and accessibility is treated as a requirement of the work rather than as a
            later correction.
          </p>
        </Section>

        <Section number="2." title="Standard applied" id="standard">
          <p className="prose">
            The target is <strong>WCAG 2.1 level AA</strong> throughout, with level AAA contrast on
            body text. The interface uses an ink-on-paper palette that reaches approximately 15:1 on
            primary text against its background, comfortably above the 7:1 that AAA requires.
          </p>
          <p className="prose mt-3">
            This also aligns with <strong>EN 301 549</strong>, the European standard for ICT
            procurement, which references WCAG 2.1 AA directly.
          </p>
        </Section>

        <Section number="3." title="What has been done" id="measures">
          <ul className="prose list-disc pl-5">
            <li>Every interactive element is reachable and operable by keyboard alone.</li>
            <li>
              Focus is always visible, and is trapped inside dialogs and returned to the control
              that opened them.
            </li>
            <li>
              A skip link leads to the main content, so keyboard and screen-reader users are not
              walked through the navigation on every page.
            </li>
            <li>
              Tables are real tables with proper header cells and scopes, not grids built from
              generic elements.
            </li>
            <li>
              No information is carried by colour alone. Warnings, errors and provisional data each
              carry an icon, a label or a hatch pattern in addition to their colour.
            </li>
            <li>
              Touch targets are at least 44 pixels, and the interface is usable one-handed at 360
              pixels wide.
            </li>
            <li>
              Motion is minimal by design, and what remains is disabled for anyone who has asked
              their system to reduce motion.
            </li>
            <li>Error messages say what happened and what to do, in plain language.</li>
          </ul>
        </Section>

        <Section number="4." title="Known limitations" id="limitations">
          <p className="prose">
            The following are known and not yet resolved. They are listed so that anybody relying on
            assistive technology knows what to expect rather than discovering it.
          </p>
          <ul className="prose mt-3 list-disc pl-5">
            <li>
              The assessment and standings screens are not yet built. When they are, every chart
              will carry a table equivalent; that commitment is recorded here in advance of the
              screens existing.
            </li>
            <li>
              Exported spreadsheets carry the data but not yet a structured cover sheet stating
              source, coverage and method.
            </li>
            <li>
              The system has been tested against keyboard navigation and automated checks. It has
              not yet been tested with a screen reader by somebody who uses one daily, which is the
              only test that really settles the question.
            </li>
          </ul>
        </Section>

        <Section number="5." title="Reporting a problem" id="feedback">
          <p className="prose">
            If any part of this system prevents you from doing something your position entitles you
            to do, that is a defect and it will be treated as one. Report it to the District
            Secretary, describing the screen, the device and the assistive technology in use if any.
          </p>
        </Section>
      </div>
    </article>
  );
}
