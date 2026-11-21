// Ready-made classifiers the user can switch on from Settings. They use the
// three question types Laya answers (POST /v1/systemone):
//   noul   – yes/no: Laya returns the probability that the answer is yes
//   choice – pick one of 2–20 options (each with an optional description)
//   score  – place the email on a scale of 2–10 levels, lowest first
// Spam is the default classifier: always present (it can be turned off, not
// removed) and shown as a likelihood.

const SPAM_ID = 'spam';

const PRESETS = [
  {
    id: SPAM_ID,
    type: 'noul',
    name: 'Spam',
    color: '#d93025',
    question: 'Is this email spam, a scam or unwanted junk mail?',
    criteria: {
      true: 'junk or scam: fake prizes, phishing, requests for money or passwords, suspicious links, or bulk marketing the reader never asked for',
      false: 'a legitimate email the reader would reasonably expect or want'
    }
  },
  {
    id: 'phishing',
    type: 'noul',
    name: 'Phishing',
    color: '#b3261e',
    question: 'Is this email trying to trick the reader into giving away passwords, codes, payment or personal details, for example by pretending to be a bank, delivery company or well-known service?'
  },
  {
    id: 'topic',
    type: 'choice',
    name: 'Topic',
    color: '#1a73e8',
    question: 'What is this email mainly about?',
    options: [
      { name: 'Work', desc: 'colleagues, clients, projects or meetings' },
      { name: 'Personal', desc: 'friends or family writing directly' },
      { name: 'Shopping', desc: 'orders, deliveries, receipts or store marketing' },
      { name: 'Finance', desc: 'banking, bills, invoices, payments or taxes' },
      { name: 'Travel', desc: 'flights, hotels, bookings or itineraries' },
      { name: 'Social', desc: 'social network or community notifications' },
      { name: 'Newsletter', desc: 'newsletters, digests or subscription content' },
      { name: 'Account', desc: 'sign-ins, verification codes or account changes' },
      { name: 'Other', desc: null }
    ]
  },
  {
    id: 'urgency',
    type: 'score',
    name: 'Urgency',
    color: '#e37400',
    question: 'How soon does the reader need to deal with this email?',
    levels: ['No action needed', 'Can wait', 'Needs attention this week', 'Urgent: today']
  },
  {
    id: 'promotions',
    type: 'noul',
    name: 'Promotions',
    color: '#9c6500',
    question: 'Is this a marketing email about sales, discounts, coupons, offers or new products?'
  },
  {
    id: 'newsletter',
    type: 'noul',
    name: 'Newsletter',
    color: '#7e57c2',
    question: 'Is this a newsletter, digest, blog update or other content sent to many subscribers?'
  },
  {
    id: 'jobs',
    type: 'noul',
    name: 'Jobs',
    color: '#188038',
    question: 'Is this email about a job: recruiting, a job offer, an interview or a job application?'
  },
  {
    id: 'finance',
    type: 'noul',
    name: 'Finance',
    color: '#0b8043',
    question: 'Is this email about money: a bank or card statement, invoice, bill, receipt, payment, refund or taxes?'
  },
  {
    id: 'security',
    type: 'noul',
    name: 'Security alert',
    color: '#c5221f',
    question: 'Is this a genuine account-security message, such as a new sign-in, password change, verification code or suspicious-activity warning?'
  },
  {
    id: 'action',
    type: 'noul',
    name: 'Needs reply',
    color: '#5f6368',
    question: 'Is a real person writing directly to the reader and asking a question or expecting a reply or action?'
  },
  {
    id: 'tone',
    type: 'choice',
    name: 'Tone',
    color: '#00838f',
    question: 'What is the tone of this email?',
    options: [
      { name: 'Friendly', desc: null },
      { name: 'Neutral', desc: null },
      { name: 'Formal', desc: null },
      { name: 'Angry', desc: 'upset, complaining or hostile' },
      { name: 'Pushy', desc: 'pressuring the reader to act fast' }
    ]
  }
];

// Laya's question types, as shown in Settings.
const TYPES = {
  noul: { label: 'Yes / No', hint: 'Laya answers with how likely it is to be "yes".' },
  choice: { label: 'Pick one', hint: 'Laya picks the best-fitting option.' },
  score: { label: 'Scale', hint: 'Laya places the email on your scale, lowest level first.' }
};

// Colours offered for custom classifiers.
const COLORS = ['#1a73e8', '#188038', '#e37400', '#7e57c2', '#00838f', '#ad1457', '#9c6500', '#5f6368', '#d93025', '#0b8043'];

const presetById = (id) => PRESETS.find((p) => p.id === id) || null;

module.exports = { PRESETS, TYPES, COLORS, SPAM_ID, presetById };
