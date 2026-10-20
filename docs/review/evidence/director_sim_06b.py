import sys, random, json
sys.path.insert(0, '/home/user/acudx-simulation')
from server import case_generator as CG
import server.condition_catalog as C
from server.orchestration.director import CaseState, next_state
cat = {c['id']: c for c in C.CATALOG}
def spec_for(cid, seed=7):
    c = cat[cid]
    return CG.build_template_spec(c, seed=seed, locale='en', acuity=c['typical_acuity'], difficulty=3, rng=random.Random(seed))
def run(cid, plan, label):
    sp = spec_for(cid)
    st = CaseState.from_spec(sp)
    out=[]
    t=0
    events = sorted(plan)  # (minute, code)
    marks=[0,10,20,30,60,90,120]
    rows=[]
    pc=[(c.id,c.deadline_ms//60000,c.required_any_of) for c in st.pending_complications]
    for m in range(1,121):
        acts=[c for (mm,c) in events if mm==m]
        for a in acts:
            st,vis,notes = next_state(st, {"kind":"treatment","ref":a,"elapsed_ms":0})
        st,vis,notes = next_state(st, {"kind":"elapsed","ref":"","elapsed_ms":60000})
        if m in marks:
            v=st.vitals
            rows.append(f"t{m:>3} HR{v.hr:>4.0f} BP{v.systolic:>4.0f}/{v.diastolic:<3.0f} RR{v.rr:>3.0f} SpO2{v.spo2:>4.0f} T{v.tempC} {st.affect.consciousness}")
    print(f"== {cid} [{label}] ESI{st.acuity_esi} planned={pc}")
    print("   treatments:", [(t.code,t.appropriateness,[(e.key,e.delta,e.onsetMs//60000) for e in t.effects]) for t in st.treatments])
    print("   triage:", sp['triage_vitals'])
    for r in rows: print("  ",r)
    print("   errors:", st.errors)
import itertools
P = {
 'septic_shock': [('none',[]),('fluids only',[(5,'313002')]),('bundle',[(5,'iv_fluids'),(10,'abx'),(20,'vasopressor')]), ('10 boluses',[(m,'313002') for m in range(2,40,4)])],
 'sepsis_uncomplicated': [('none',[]),('paracetamol only',[(5,'161')])],
 'pneumonia_cap': [('none',[]),('abx+o2',[(10,'severity_abx'),(10,'oxygen')])],
 'bacterial_meningitis': [('none',[]),('ceftriaxone at 50min',[(50,'2193')])],
 'pyelonephritis': [('none',[])],
 'dka': [('none',[]),('insulin bolus first',[(5,'insulin_bolus_first')])],
 'acs_stemi': [('none',[]),('aspirin only',[(5,'asa_p2y12')]),('routine o2',[(3,'routine_o2')])],
 'pulmonary_embolism': [('none',[]),('anticoag',[(10,'anticoag')])],
 'anaphylaxis': [('none',[]),('IM adrenaline',[(3,'3992-im')]),('fluids only',[(3,'313002')])],
 'heart_failure_acute': [('none',[]),('3 L fluid',[(m,'313002') for m in (5,10,15,20,25,30)])],
}
for cid, plans in P.items():
    for label, plan in plans:
        try: run(cid, plan, label)
        except Exception as e: print(cid, label, 'ERR', e)
