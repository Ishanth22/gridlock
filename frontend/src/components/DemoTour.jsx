import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function DemoTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(null);

  useEffect(() => {
    const checkStep = () => {
      const currentStep = sessionStorage.getItem('gridlock_demo_step');
      setStep(currentStep ? Number(currentStep) : null);
    };

    checkStep();
    const interval = setInterval(checkStep, 300);
    return () => clearInterval(interval);
  }, []);

  if (!step) return null;

  const steps = [
    {
      title: 'Step 1 of 6: Spatial Hotspot Ingestion',
      text: 'Our AI model dynamically aggregates parking offenses across Bengaluru. H3 resolution 8 cells are color-coded by their Congestion Impact Score (CIS). Select a red/critical cell on the map to inspect live metrics, then click Next.',
      nextPath: '/predict',
      buttonText: 'Next: Predictive Risk & Explainability →',
      expectedPath: '/'
    },
    {
      title: 'Step 2 of 6: Predictive Risk & Explainability',
      text: 'Using a LightGBM regressor, the platform forecasts tomorrow\'s violation counts. The SHAP explainability waterfall shows exactly which factors (e.g. peak hour, road class) drive the risk score. Select any cell on the left, then click Next.',
      nextPath: '/cctv',
      buttonText: 'Next: CCTV Video Analytics Simulator →',
      expectedPath: '/predict'
    },
    {
      title: 'Step 3 of 6: Live CV Detection & VAHAN Warnings',
      text: 'Real-time CCTV cameras track vehicles in no-parking zones, drawing bounding boxes and running stationary timers. Once a breach is detected, it queries a simulated VAHAN database and sends a pre-enforcement SMS warning to the owner.',
      nextPath: '/enforce',
      buttonText: 'Next: Dynamic Route Optimization →',
      expectedPath: '/cctv'
    },
    {
      title: 'Step 4 of 6: Dynamic Route Optimization',
      text: 'If warnings are ignored, officers are dynamically routed. The system groups targets via weighted K-Means clustering and snaps optimized TSP patrol paths to Bengaluru roads instantly (<5ms) using pre-calculated cached routes.',
      nextPath: '/field',
      buttonText: 'Next: Officer Field Clearance Portal →',
      expectedPath: '/enforce'
    },
    {
      title: 'Step 5 of 6: Officer Field Action',
      text: 'This is the mobile portal for field officers. It displays their assigned route and live checklist. Click "Clear Hotspot" on the first target to simulate an officer clearing the double-parked vehicles and resolving the bottleneck.',
      nextPath: '/',
      buttonText: 'Next: Congestion Decay & Feedback Loop →',
      expectedPath: '/field'
    },
    {
      title: 'Step 6 of 6: Closed-Loop Recovery & Decay',
      text: 'With the hotspot cleared, the online learning loop dynamically decays the CIS score and predicted congestion metrics in real-time, demonstrating complete gridlock recovery and traffic throughput improvement. Excellent job!',
      nextPath: null,
      buttonText: 'Finish Demo Tour 🎉',
      expectedPath: '/'
    }
  ];

  const currentStepData = steps[step - 1];
  if (!currentStepData) return null;

  const handleNext = () => {
    if (currentStepData.nextPath) {
      sessionStorage.setItem('gridlock_demo_step', String(step + 1));
      navigate(currentStepData.nextPath);
    } else {
      sessionStorage.removeItem('gridlock_demo_step');
      setStep(null);
    }
  };

  const handleQuit = () => {
    sessionStorage.removeItem('gridlock_demo_step');
    setStep(null);
  };

  return (
    <div className="demo-tour-overlay">
      <div className="demo-tour-card">
        <div className="demo-tour-header">
          <span className="demo-tour-title">{currentStepData.title}</span>
          <button className="demo-tour-close" onClick={handleQuit}>×</button>
        </div>
        <p className="demo-tour-text">{currentStepData.text}</p>
        <div className="demo-tour-actions">
          <button className="btn btn-ghost" style={{ border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.75rem', padding: '6px 12px' }} onClick={handleQuit}>
            Quit Demo
          </button>
          <button className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '6px 12px', background: 'var(--color-primary)' }} onClick={handleNext}>
            {currentStepData.buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}
