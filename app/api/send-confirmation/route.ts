import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, email, date, time, reservationNumber, customAnswers } = body as {
    name: string;
    email: string;
    date: string;
    time: string;
    reservationNumber: string;
    customAnswers?: Record<string, string>;
  };

  const customAnswerLines = customAnswers
    ? Object.entries(customAnswers)
        .filter(([, v]) => v)
        .map(([k, v]) => `<li>${k}: ${v}</li>`)
        .join('')
    : '';

  try {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: `【予約確認】${reservationNumber}`,
      html: `
        <p>${name} 様</p>
        <p>以下の内容でご予約を承りました。</p>
        <ul>
          <li>予約番号: <strong>${reservationNumber}</strong></li>
          <li>日付: ${date}</li>
          <li>時間: ${time}</li>
          ${customAnswerLines}
        </ul>
        <p>ご来院をお待ちしております。</p>
      `,
    });
  } catch (err) {
    console.error('確認メール送信エラー:', err);
    return NextResponse.json({ success: false, message: 'メール送信に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: '確認メールを送信しました' });
}
