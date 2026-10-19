import { describe, it, expect } from "vitest";
import { localPassages } from "@/lib/guidanceEngine";

/**
 * Review 02 finding 27 (major): offline guidance leads must name their true
 * source with a resolving URL (protocol rule 2), never the TEPDAD framework
 * that did not author them.
 */
describe("guidanceEngine — offline passages carry honest, resolving attribution", () => {
  it("attributes the metabolic lead to ADA/EASD 2024 with a DOI", () => {
    const [lead] = localPassages(["tepdad-em"], "en", ["fluids-insulin"]);
    expect(lead.citation).toBe("ADA/EASD 2024");
    expect(lead.url).toBe("https://doi.org/10.2337/dci24-0032");
    expect(lead.source).not.toMatch(/tepdad/i);
    expect(lead.text).toMatch(/3\.3 mmol\/L/);
  });

  it("gives the ESC and NICE statements their guideline URLs", () => {
    const [esc] = localPassages(["esc-acs-2023"], "en");
    expect(esc.url).toBe("https://doi.org/10.1093/eurheartj/ehad191");
    const [sah] = localPassages(["nice-ng228"], "tr");
    expect(sah.url).toBe("https://www.nice.org.uk/guidance/ng228");
  });

  it("leaves the generic competency lead without a URL (rendered as degraded, not cited)", () => {
    const [generic] = localPassages(["tepdad-em"], "en");
    expect(generic.url).toBeUndefined();
  });
});
