/**
 * Janela em que uma confirmação de senha ainda vale para ação sensível.
 *
 * Em `$shared` porque o servidor aplica a regra e as telas a explicam ("vale
 * por 15 minutos"). Um número escrito em dois lugares diverge no primeiro
 * ajuste.
 */
export const REAUTH_WINDOW_MINUTES = 15;
