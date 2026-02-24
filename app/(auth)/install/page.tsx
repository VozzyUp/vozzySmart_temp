'use client';

import { useReducer, useCallback, useEffect, useRef, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { playTransition } from '@/hooks/useSoundFX';
import {
  installReducer,
  initialState,
  isCollecting,
  isProvisioning,
  isError,
  isSuccess,
  persistState,
  hydrateState,
  clearPersistedState,
  createInitialState,
} from '@/lib/installer/machine';
import {
  InstallData,
  InstallStep,
  ProvisionStreamEvent,
  actions,
  isProgressEvent,
  isErrorEvent,
  isCompleteEvent,
} from '@/lib/installer/types';
import { InstallLayout } from '@/components/install/InstallLayout';
import { StepCard } from '@/components/install/StepCard';
import {
  LicenseForm,
  GitHubForm,
  IdentityForm,
  VercelForm,
  SupabaseForm,
  QStashForm,
  RedisForm,
} from '@/components/install/forms';
import { ProvisioningView } from '@/components/install/ProvisioningView';
import { SuccessView } from '@/components/install/SuccessView';
import { ErrorView } from '@/components/install/ErrorView';

// =============================================================================
// ANIMATION VARIANTS
// =============================================================================

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
};

// =============================================================================
// INITIAL STATE WITH HYDRATION
// =============================================================================

function getInitialState() {
  // No SSR, retorna estado padrão
  if (typeof window === 'undefined') return initialState;

  // Tenta recuperar estado salvo
  const savedState = hydrateState();
  if (savedState) {
    console.log('[Installer] Estado recuperado do localStorage');
    return savedState;
  }

  return initialState;
}

// =============================================================================
// MAIN PAGE
// =============================================================================

function InstallPageContent() {
  const [state, dispatch] = useReducer(installReducer, undefined, getInitialState);
  const prevStepRef = useRef<number | null>(null);

  // ---------------------------------------------------------------------------
  // PERSISTÊNCIA (MELHORIA #9)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Persiste estado a cada mudança (exceto provisioning)
    persistState(state);
  }, [state]);

  // Limpa estado persistido quando chega no success
  useEffect(() => {
    if (isSuccess(state)) {
      clearPersistedState();
    }
  }, [state]);

  // Som de transição entre steps
  useEffect(() => {
    if (isCollecting(state)) {
      const currentStep = state.step;
      if (prevStepRef.current !== null && prevStepRef.current !== currentStep) {
        playTransition();
      }
      prevStepRef.current = currentStep;
    }
  }, [state]);

  // ---------------------------------------------------------------------------
  // HANDLERS - AGORA USANDO ACTION CREATORS
  // ---------------------------------------------------------------------------

  const handleStepComplete = useCallback((stepData: Partial<InstallData>) => {
    // ✅ MELHORIA: Ação atômica evita race condition
    dispatch(actions.submitStep(stepData));
  }, []);

  const handleBack = useCallback(() => {
    // ✅ MELHORIA: Direction agora é gerenciado pelo reducer
    dispatch(actions.back());
  }, []);

  const handleProvisionProgress = useCallback((event: ProvisionStreamEvent) => {
    // ✅ MELHORIA: Type guards garantem tipagem correta
    if (isProgressEvent(event)) {
      dispatch(actions.progress(event.progress, event.title, event.subtitle));
    } else if (isErrorEvent(event)) {
      dispatch(actions.error(event.error, event.returnToStep, event.errorDetails));
    } else if (isCompleteEvent(event)) {
      dispatch(actions.complete());
    }
  }, []);

  const handleRetry = useCallback(() => {
    dispatch(actions.retry());
  }, []);

  const handleGoToStep = useCallback((step: InstallStep) => {
    // ✅ MELHORIA: Direction calculado pelo reducer
    dispatch(actions.goToStep(step));
  }, []);

  const handleReset = useCallback(() => {
    // Critical #2: Permite recomeçar do zero após interrupção
    dispatch(actions.reset());
  }, []);

  // ---------------------------------------------------------------------------
  // RENDER: COLLECTING PHASE
  // ---------------------------------------------------------------------------

  if (isCollecting(state)) {
    const { step, data, direction } = state; // ✅ Tudo vem do state agora

    const glowColors: Record<InstallStep, 'cyan' | 'magenta' | 'orange' | 'red'> = {
      1: 'cyan',
      2: 'magenta',
      3: 'cyan',
      4: 'magenta',
      5: 'cyan',
      6: 'orange',
      7: 'red',
    };

    const renderForm = () => {
      const formProps = {
        data, // ✅ Vem do state.data
        onComplete: handleStepComplete,
        onBack: handleBack,
        showBack: step > 1,
      };

      switch (step) {
        case 1:
          return <LicenseForm key="license" {...formProps} />;
        case 2:
          return <GitHubForm key="github" {...formProps} />;
        case 3:
          return <IdentityForm key="identity" {...formProps} />;
        case 4:
          return <VercelForm key="vercel" {...formProps} />;
        case 5:
          return <SupabaseForm key="supabase" {...formProps} />;
        case 6:
          return <QStashForm key="qstash" {...formProps} />;
        case 7:
          return <RedisForm key="redis" {...formProps} />;
        default:
          return null;
      }
    };

    return (
      <InstallLayout currentStep={step} totalSteps={7}>
        {/* Botão "Voltar" removido - já existe dentro dos forms */}
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 30,
            }}
          >
            <StepCard glowColor={glowColors[step]}>
              {renderForm()}
            </StepCard>
          </motion.div>
        </AnimatePresence>
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs font-mono text-[var(--br-dust-gray)] hover:text-[var(--br-neon-cyan)] underline-offset-4 hover:underline"
          >
            Reiniciar instalação do zero
          </button>
        </div>
      </InstallLayout>
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER: PROVISIONING PHASE
  // ---------------------------------------------------------------------------

  if (isProvisioning(state)) {
    return (
      <InstallLayout showDots={false}>
        <ProvisioningView
          data={state.data} // ✅ Vem do state.data
          progress={state.progress}
          title={state.title}
          subtitle={state.subtitle}
          onProgress={handleProvisionProgress}
          onReset={handleReset} // Critical #2: Permite recomeçar após interrupção
        />
      </InstallLayout>
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER: ERROR PHASE
  // ---------------------------------------------------------------------------

  if (isError(state)) {
    return (
      <InstallLayout showDots={false}>
        <ErrorView
          error={state.error}
          errorDetails={state.errorDetails}
          onRetry={handleRetry}
          onGoToStep={handleGoToStep}
          returnToStep={state.returnToStep}
          onReset={handleReset}
        />
      </InstallLayout>
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER: SUCCESS PHASE
  // ---------------------------------------------------------------------------

  if (isSuccess(state)) {
    return (
      <InstallLayout showDots={false}>
        <SuccessView name={state.data.name} /> {/* ✅ Vem do state.data */}
      </InstallLayout>
    );
  }

  return null;
}

export default function InstallPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[var(--br-void-black)]"><div className="w-8 h-8 border-2 border-[var(--br-neon-cyan)] border-t-transparent rounded-full animate-spin" /></div>}>
      <InstallPageContent />
    </Suspense>
  );
}
