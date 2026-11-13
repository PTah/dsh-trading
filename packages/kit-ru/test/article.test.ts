import { describe, expect, it } from 'vitest'
import { extractArticleHtml, publicNewsUrl, publisherUrl, readNewsArticle } from '../src/article.ts'

describe('news article reader', () => {
  it('Agent: unwraps a Google News article token to the publisher address', () => {
    const publisher = 'https://finmarket.ru/news/12345'
    const token = Buffer.from(`\u0008\u0013${publisher}`, 'utf8').toString('base64url')
    expect(publisherUrl(`https://news.google.com/rss/articles/${token}`)).toBe(publisher)
    expect(publicNewsUrl('http://127.0.0.1/secret')).toBeUndefined()
    expect(publicNewsUrl('file:///C:/news.html')).toBeUndefined()
  })

  it('Agent: keeps the article heading and the long paragraphs', () => {
    const html = `<html><nav><p>${'меню '.repeat(30)}</p></nav><article>
      <h1>Рынок открылся ростом</h1>
      <p>коротко</p>
      <p>${'Индекс Мосбиржи вырос на ожиданиях переговоров. '.repeat(4)}</p>
      <p>${'Второй абзац про облигации и рубль тоже достаточно длинный для чтения. '.repeat(3)}</p>
    </article></html>`
    const article = extractArticleHtml(html, 'запасной')
    expect(article.title).toBe('Рынок открылся ростом')
    expect(article.paragraphs).toHaveLength(2)
    expect(article.paragraphs[0]).toContain('Индекс Мосбиржи')
  })

  it('Agent: reads the publisher page instead of the Google wrapper', async () => {
    const publisher = 'https://finmarket.ru/news/1'
    const token = Buffer.from(publisher, 'utf8').toString('base64url')
    const calls: string[] = []
    const article = await readNewsArticle(`https://news.google.com/rss/articles/${token}`, async (input) => {
      calls.push(String(input))
      return new Response(`<article><h1>Заголовок</h1><p>${'Текст новости внутри терминала, без внешнего браузера. '.repeat(4)}</p></article>`, { status: 200 })
    })
    expect(calls).toEqual([publisher])
    expect(article.sourceHost).toBe('finmarket.ru')
    expect(article.title).toBe('Заголовок')
    expect(article.paragraphs[0]).toContain('внутри терминала')
  })
})
