import { Link } from 'react-router-dom';
import { Panel } from '../components/Panel';

export function HomePage() {
  return (
    <div className="chassis-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <Panel title="Xenolinguistic Communication Terminal" code="XCT‑01" className="" >
        <div style={{ display: 'grid', gap: 12, minWidth: 'min(90vw, 420px)' }}>
          <p className="hint" style={{ margin: 0 }}>
            Selecciona el rol de este dispositivo.
          </p>
          <Link to="/console" className="hw-btn amber" style={{ textDecoration: 'none', padding: 16 }}>
            Consola (computador con parlante)
          </Link>
          <p className="hint" style={{ margin: 0 }}>
            El mando se abre escaneando el QR que muestra la consola; necesita la sesión y el token en la URL.
          </p>
          <Link to="/remote" className="hw-btn" style={{ textDecoration: 'none' }}>
            Mando (sin enlace: mostrará error)
          </Link>
        </div>
      </Panel>
    </div>
  );
}
