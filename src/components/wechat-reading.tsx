import { ChevronLeft, Heart, MessageSquare, MoreHorizontal, Share2, ThumbsUp, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { PreviewHtml } from './preview-html'

export function WechatReading({ title, html, accountName, authorName, avatar, onClose }: {
  title: string
  html: string
  accountName: string
  authorName: string
  avatar?: ReactNode
  onClose: () => void
}) {
  return <div className="mobile-wechat-preview">
    <header className="wechat-reading-nav">
      <button type="button" onClick={onClose} aria-label="返回工作台"><ChevronLeft size={25} /></button>
      <span />
      <span aria-label="更多（效果示意）"><MoreHorizontal size={25} /></span>
    </header>
    <div className="mobile-article-scroll">
      <h1>{title || '未命名文章'}</h1>
      <div className="wechat-reading-meta">
        <div className="wechat-reading-byline"><span className="wechat-original">原创</span><span>{authorName}</span><span className="wechat-account-name">{accountName}</span></div>
        <div className="wechat-reading-date"><span aria-label="发布时间">待发布</span></div>
      </div>
      <PreviewHtml className="mobile-wechat-content" html={html} />
    </div>
    <footer className="wechat-reading-footer" aria-label="公众号阅读底栏（效果示意）">
      <div className="wechat-reading-account"><span className="wechat-reading-avatar">{avatar || <UserRound size={22} />}</span><strong>{accountName}</strong></div>
      <div className="wechat-reading-actions">
        <span aria-label="点赞（效果示意）"><ThumbsUp size={22} /></span>
        <span aria-label="分享（效果示意）"><Share2 size={22} /></span>
        <span aria-label="喜欢（效果示意）"><Heart size={22} /></span>
        <span aria-label="评论（效果示意）"><MessageSquare size={22} /></span>
      </div>
    </footer>
  </div>
}
