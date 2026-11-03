import type { Metadata } from 'next';

import { renderContent } from '@/lib/content';
import { pageMeta } from '@/lib/meta';

// The Korean translation Samsung's Seller Office asks for beside the English
// policy; content/privacy-ko.md changes whenever content/privacy.md does.
export const metadata: Metadata = pageMeta({
  title: '개인정보 처리방침',
  description: 'Pleione이 TV에 저장하는 정보, 보내는 정보와 그 대상, 그리고 삭제 방법.',
  path: '/privacy/ko/',
  card: 'privacy',
});

export default function PrivacyKorean() {
  return (
    <div className="wrap">
      <article lang="ko" className="prose" dangerouslySetInnerHTML={{ __html: renderContent('privacy-ko') }} />
    </div>
  );
}
