import { describe, it, expect } from "vitest";
import {
  canPlaceOrder,
  NURSE_PROTOCOL_ORDERS,
  PARAMEDIC_INTERVENTIONS,
  orderableCodesFor,
  protocolDetailFor,
} from "@/domain/scopeOfPractice";
import { ROLE_SCOPES } from "@/data/rooms";
import { TREATMENT_CATALOG } from "@/domain/treatments";

/**
 * Review 02 finding 24 (nurse protocol orders; AJEM 2018 nurse-driven ECG,
 * ESC 2023 10-minute ECG) and finding 25 (paramedic prehospital set; NHTSA
 * National EMS Scope of Practice Model 2019).
 */
describe("scope of practice — role ordering", () => {
  it("lets the nurse initiate the 12-lead ECG, POC glucose, IV access and oxygen under protocol", () => {
    for (const code of ["11524-6", "poc-glucose", "iv-access", "7806", "urine-hcg", "monitoring"]) {
      expect(canPlaceOrder("nurse", code), code).toBe(true);
    }
    expect(ROLE_SCOPES.nurse.canOrder).toBe(false);
    expect(ROLE_SCOPES.nurse.protocolOrders).toContain("11524-6");
  });

  it("keeps prescribing medications and imaging with the doctor", () => {
    expect(canPlaceOrder("nurse", "7052")).toBe(false); // morphine
    expect(canPlaceOrder("nurse", "2193")).toBe(false); // ceftriaxone
    expect(canPlaceOrder("nurse", "ctpa")).toBe(false);
    expect(canPlaceOrder("doctor", "7052")).toBe(true);
    expect(canPlaceOrder("doctor", "ctpa")).toBe(true);
  });

  it("gives the paramedic the national prehospital intervention set", () => {
    for (const code of ["7806", "1191", "4917", "7242", "3992-im", "435", "313002", "11524-6", "cpr-defib"]) {
      expect(canPlaceOrder("paramedic", code), code).toBe(true);
    }
    expect(canPlaceOrder("paramedic", "2193")).toBe(false); // no antibiotics prehospital
    expect(canPlaceOrder("paramedic", "8410")).toBe(false); // no thrombolysis
    expect(ROLE_SCOPES.paramedic.protocolOrders).toEqual([...PARAMEDIC_INTERVENTIONS]);
  });

  it("the paramedic adrenaline is the IM entry, never the IV vasopressor", () => {
    expect(PARAMEDIC_INTERVENTIONS.has("3992-im")).toBe(true);
    expect(PARAMEDIC_INTERVENTIONS.has("3992")).toBe(false);
    expect(NURSE_PROTOCOL_ORDERS.has("3992")).toBe(false);
  });

  it("filters a catalogue by role and labels protocol orders", () => {
    const codes = TREATMENT_CATALOG.map((t) => t.code);
    expect(orderableCodesFor("doctor", codes)).toEqual(codes);
    expect(orderableCodesFor("nurse", codes)).toEqual(["7806"]);
    expect(protocolDetailFor("nurse")?.en).toMatch(/per protocol/i);
    expect(protocolDetailFor("doctor")).toBeUndefined();
  });
});
