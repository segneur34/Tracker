import { Component, type ErrorInfo, type ReactNode } from 'react';
import Button from './ui/Button';

/**
 * Limite d'erreur : une exception au rendu d'une page n'efface plus toute
 * l'application. Autour de la page (`AppShell`), la barre, les bandeaux et le
 * bouton rond restent, et un enregistrement en cours peut toujours s'arrêter ;
 * la clé `resetKey` (l'adresse) la réarme à chaque page. Autour de toute
 * l'application (`main.tsx`), sans `onHome`, le bouton la recharge sur
 * l'accueil.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Revenir à l'accueil depuis la page en erreur ; sans lui, l'application est rechargée sur l'accueil. */
  onHome?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Erreur au rendu', error, info.componentStack);
  }

  private goHome = () => {
    const { onHome } = this.props;
    if (!onHome) {
      window.location.replace('/');
      return;
    }
    // Remise à zéro d'abord : l'erreur peut venir de l'accueil lui-même, dont l'adresse ne change pas.
    this.setState({ error: null });
    onHome();
  };

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="ui-page">
        <section className="ui-card" role="alert">
          <h2 className="ui-card__title">Cette page n'a pas pu s'afficher</h2>
          <p style={{ margin: '0 0 var(--space-3)' }}>
            Une erreur inattendue l'a interrompue. Rien n'est effacé, et un enregistrement en cours continue.
          </p>
          <p className="num" style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--muted)', overflowWrap: 'anywhere' }}>
            {error.message || error.name}
          </p>
          <Button variant="primary" onClick={this.goHome}>Revenir à l'accueil</Button>
        </section>
      </div>
    );
  }
}

/** Page de développement qui lève au rendu : essai de la limite d'erreur au banc (`/essai/erreur`). */
export function DevThrow(): ReactNode {
  throw new Error('Erreur levée exprès (essai de la limite d’erreur)');
}

export default ErrorBoundary;
