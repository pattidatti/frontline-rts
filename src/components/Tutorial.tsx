import { useState } from 'react';

const STORAGE_KEY = 'frontline_tutorial_td_done';

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: 'Velkommen, Maur-konge!',
    body: 'Kolonien din ligger i vest. I øst rykker fiendebølger fram langs 3 lanes (Nord, Midt, Sør). Hold maurtua di i live i 15 bølger — så vinner du. Panorér kameraet med WASD eller piltaster, eller klikk på Slagmark-minimapet. Trykk H når som helst for alle hurtigtaster.',
  },
  {
    title: 'Send soldater i en lane',
    body: 'I høyrepanelet ser du 3 knapper: Nord, Midt og Sør. Hver knapp koster mat og spawner én soldat ved basen din som marsjerer østover i den lanen. Soldater er låst til sin lane — så velg klokt hvor fienden er sterkest. Hurtigtaster: Q = Nord, R = Midt, E = Sør.',
  },
  {
    title: 'Bygg tårn utenfor lanene',
    body: 'Klikk Spydd / Nett / Spytt (eller trykk T) for å gå inn i bygg-modus. Venstreklikk på gress UTENFOR lane-bånd for å plassere et tårn — tårn skyter på creeps som passerer forbi. Spydd = single-target, Nett = slow, Spytt = splash. Shift+klikk for å plassere flere. Esc avbryter.',
  },
  {
    title: 'Forbered deg mellom bølger',
    body: 'Mellom hver bølge har du en kort pause med countdown. Bruk den til å bygge tårn og samle opp mat. Når du føler deg klar: trykk G eller klikk "Klar!" for å starte neste bølge med en gang. Du får passiv mat-inntekt + ekstra mat per drept fiende.',
  },
  {
    title: 'Pass på basen!',
    body: 'Hvis en creep når basen din, mister du HP. Når HP når 0 — game over. Senere bølger har tank- og boss-fiender (større, sterkere) — disse gir mer mat når du dreper dem, men er vanskelige å stoppe. Bruk Nett-tårn til å bremse dem, Spydd til høy single-target damage, og soldater til å blokkere veien.',
  },
];

export function Tutorial() {
  const [step, setStep] = useState<number>(() => {
    if (typeof window === 'undefined') return -1;
    return localStorage.getItem(STORAGE_KEY) === 'true' ? -1 : 0;
  });

  if (step < 0) return null;

  const close = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setStep(-1);
  };
  const next = () => {
    if (step >= STEPS.length - 1) close();
    else setStep(step + 1);
  };
  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <div style={progressStyle}>
            Trinn {step + 1} / {STEPS.length}
          </div>
          <button
            onClick={close}
            style={skipButtonStyle}
            aria-label="Hopp over tutorial"
          >
            Hopp over
          </button>
        </div>
        <div style={titleStyle}>{s.title}</div>
        <div style={bodyStyle}>{s.body}</div>
        <div style={footerStyle}>
          <button
            onClick={prev}
            disabled={step === 0}
            style={{ ...navButtonStyle, opacity: step === 0 ? 0.35 : 1 }}
          >
            Forrige
          </button>
          <div style={dotsStyle}>
            {STEPS.map((_, i) => (
              <div key={i} style={{ ...dotStyle, background: i === step ? '#b8945a' : '#3a2614' }} />
            ))}
          </div>
          <button onClick={next} style={{ ...navButtonStyle, ...primaryButtonStyle }}>
            {isLast ? 'Start' : 'Neste'}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
  zIndex: 50,
  pointerEvents: 'auto',
  fontFamily: 'Inter, system-ui, sans-serif',
};

const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(20,13,7,0.98) 0%, rgba(10,6,3,0.98) 100%)',
  border: '1px solid #6a4a28',
  borderRadius: 8,
  padding: '22px 28px 18px',
  width: 460,
  maxWidth: '90vw',
  color: '#e6d8a6',
  boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 14,
};

const progressStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#a89878',
};

const skipButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#6a5a3a',
  fontSize: 12,
  cursor: 'pointer',
  padding: '4px 8px',
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: '#f5dc6e',
  marginBottom: 8,
  letterSpacing: '0.01em',
};

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: '#d8c89a',
  marginBottom: 18,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const navButtonStyle: React.CSSProperties = {
  background: 'rgba(58,38,20,0.6)',
  border: '1px solid #6a4a28',
  color: '#e6d8a6',
  padding: '8px 16px',
  fontSize: 13,
  cursor: 'pointer',
  borderRadius: 4,
  fontFamily: 'inherit',
};

const primaryButtonStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, #6a4a28 0%, #4a2c14 100%)',
  borderColor: '#b8945a',
  color: '#ffe898',
  fontWeight: 600,
};

const dotsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  transition: 'background 0.15s',
};
