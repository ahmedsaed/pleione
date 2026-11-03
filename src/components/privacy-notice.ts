import { CONFIG } from '../config';
import { t } from '../i18n';
import { platform } from '../platform';
import { StorageService } from '../services/storage-service';
import { createLogger } from '../utils/logger';
import { ConfirmationPrompt } from './confirmation-prompt';

const log = createLogger('Privacy');

// Samsung's privacy guide asks for consent, with what is kept, why, for how
// long, and what refusing costs, before the app stores a source. Only
// platforms that ask (platform.privacyConsent) show the notice.
let prompt: ConfirmationPrompt | null = null;

export function needsPrivacyConsent(): boolean {
  return platform.privacyConsent && !StorageService.hasPrivacyConsent();
}

/**
 * Runs `onAgree` at once where no consent is needed or it was given;
 * otherwise asks first. "Not now" runs `onDecline` and keeps no answer, so
 * the next try to add a source asks again.
 */
export function withPrivacyConsent(onAgree: () => void, onDecline: () => void = () => {}): void {
  if (!needsPrivacyConsent()) {
    onAgree();
    return;
  }
  prompt ??= new ConfirmationPrompt('privacy-notice');
  prompt.show({
    title: t('privacy.noticeTitle'),
    message: t('privacy.noticeMessage', { name: CONFIG.APP_NAME }),
    confirmLabel: t('privacy.agree'),
    cancelLabel: t('common.notNow'),
    confirmTone: 'primary',
    dialogClass: 'privacy-notice-dialog',
    onConfirm: () => {
      StorageService.setPrivacyConsent();
      log.info('Privacy notice agreed', 'event=privacy.consent', 'outcome=agreed');
      onAgree();
    },
    onCancel: () => {
      log.info('Privacy notice declined', 'event=privacy.consent', 'outcome=declined');
      onDecline();
    },
  });
}

