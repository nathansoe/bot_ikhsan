const mysql = require('mysql2');
const Imap = require('imap');
const simpleParser = require('mailparser').simpleParser;
const moment = require('moment-timezone');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const delay = require('delay')
puppeteer.use(StealthPlugin());

const emailConfig = {
  user: "akunmutr@gmail.com",
  password: "tsfz kdei bybw lhkb",
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
  tlsOptions: {
    rejectUnauthorized: false,
  },
  connectTimeout: 100000,
  authTimeout: 30000,
};

const magicLinkSubjects = [
  'Penting: Cara memperbarui Rumah dengan Akun Netflix-mu',
  'Important: How to update your Netflix Household',
];

const createDbConnection = () => {
  return mysql.createConnection({
    host: '128.199.140.201',
    user: 'vertifikasi',
    password: 'vertifikasi',
    database: 'vertifikasi'
  });
};

let dbConnection = createDbConnection();

dbConnection.on('error', (err) => {
  console.error('Error Connection MySQL:', err);
  if (err.fatal) {
    while (true) {
      try {
        console.log('Trying to reconnect MySQL...');
        dbConnection = createDbConnection();
        break;
      } catch (e) {
        continue;
      }
    }
  }
});

const batchSaveToDatabase = async (emailDataArray) => {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO vertifikasi (email, status, date, date_clicked, link) VALUES ?`;
    const values = emailDataArray.map(({ email, status, date, date_clicked, link }) => [email, status, date, date_clicked, link]);

    dbConnection.query(sql, [values], (err, result) => {
      if (err) {
        console.error('Error saving to database:', err);
        reject(err);
      } else {
        console.log("Batch email data has been successfully saved to the database.");
        resolve(result);
      }
    });
  });
};

const isLinkExists = (link) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT COUNT(*) AS count FROM vertifikasi WHERE link = ?';
    dbConnection.query(sql, [link], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results[0].count > 0);
      }
    });
  });
};

const formatImapDate = (date) => {
  return moment(date).utc().format('DD-MMM-YYYY HH:mm:ss') + ' +0000';
};

const isEmailRecent = (emailDate) => {
  const now = moment().tz('Asia/Jakarta');
  const emailTime = moment(emailDate).tz('Asia/Jakarta');
  return now.diff(emailTime, 'minutes') <= 15;
};

const searchEmails = (imap, criteria) => {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) {
        console.error('Error searching emails:', err);
        return reject(err);
      }
      resolve(results.sort((a, b) => b - a));
    });
  });
};

const processSingleEmail = async (imap, emailId, browser) => {
  return new Promise((resolve) => {
    const email = imap.fetch(emailId, { bodies: '' });

    email.on('message', async (msg, seqno) => {
      msg.on('body', async (stream) => {
        const mail = await simpleParser(stream).catch((err) => {
          console.error('Error parsing email:', err);
          return null;
        });

        if (!mail) return;

        const date_clicked = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
        const emailDateInJakarta = moment(mail.date).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
        const emailData = {
          email: mail.to.text,
          date: emailDateInJakarta,
          date_clicked: date_clicked,
          link: '',
          status: 'INVALID'
        };

        console.log(`\nProcessing email from: ${mail.to.text}\nSubject: ${mail.subject}\nDate: ${emailDateInJakarta}`);

        if (isEmailRecent(mail.date)) {
          const linkRegex = /https:\/\/www\.netflix\.com\/account\/update-primary-location\?[^\s'"<\]]+/g;
          const matches = mail.text.match(linkRegex);

          if (matches) {
            for (const match of matches) {
              if (!(await isLinkExists(match))) {
                emailData.link = match;
                console.log(`Found link: ${match}`);

                try {
                  const page = await browser.newPage();
                  const userAgent = new UserAgent();
                  await page.setUserAgent(userAgent.toString());

                  await page.goto(match, { waitUntil: 'networkidle2' });
                  const buttonSelector = '[data-uia=set-primary-location-action]';
                  const buttonExists = await page.$(buttonSelector) !== null;

                  if (buttonExists) {
                    await page.click(buttonSelector);
                    await delay(10000)
                    const pageSelector = '[data-uia=upl-success]';
                    const pageExists = await page.$(pageSelector) !== null;

                    if (pageExists) {
                      emailData.status = 'DIKONFIRMASI';
                    } else {
                      emailData.status = 'INVALID';
                    }
                  } else {
                    console.log('Button selector not found. Setting status to INVALID.');
                    emailData.status = 'INVALID';
                  }

                  await page.close();
                } catch (e) {
                  console.error('Error navigating to link:', e.message);
                  emailData.status = 'INVALID';
                }

                await batchSaveToDatabase([emailData]);
              } else {
                console.log('Link already exists in the database, skipping...');
              }
            }
          } else {
            console.log('No links found.');
          }
        } else {
          console.log('Email is older than 15 minutes.');
        }
        resolve();
      });

      email.once('error', (err) => {
        console.error('Error fetching email:', err);
        resolve();
      });
    });
  });
};

const processEmailsWithConcurrency = async (imap, results, browser) => {
  const concurrencyLimit = 2; // Reduced to minimize resource usage
  let currentIndex = 0;

  const processNextEmail = async () => {
    if (currentIndex >= results.length) return;
    const emailId = results[currentIndex++];
    await processSingleEmail(imap, emailId, browser);
    await processNextEmail();
  };

  // Start processing
  const promises = [];
  for (let i = 0; i < concurrencyLimit; i++) {
    promises.push(processNextEmail());
  }
  await Promise.all(promises);
};

const checkEmails = async (imap) => {
  const startTime = moment();
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // Path Browser
    headless: true, // Running in headless mode to save resources
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
1
  while (true) {
    try {
      const fifteenMinutesAgo = moment().tz('Asia/Jakarta').subtract(15, 'minutes').toDate();
      const formattedDate = formatImapDate(fifteenMinutesAgo);

      const searchCriteria = [
        ['SINCE', formattedDate],
        ['OR', ['SUBJECT', magicLinkSubjects[0]], ['SUBJECT', magicLinkSubjects[1]]]
      ];

      const results = await searchEmails(imap, searchCriteria);

      if (results.length > 0) {
        await processEmailsWithConcurrency(imap, results, browser);
        console.log('\nProcessed emails. Rechecking...');
      } else {
        console.log('No recent emails found. Rechecking...');
      }

      const currentTime = moment();
      if (currentTime.diff(startTime, 'minutes') >= 1) {
        console.log('\n1 minutes elapsed. Restarting process...');
        break;
      }
    } catch (error) {
      console.error('Error during email processing:', error);
    }

    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  await browser.close();
};


// Restart program interval
const startProcess = async () => {
  const imap = new Imap(emailConfig);

  imap.once('ready', async () => {
    console.log('IMAP connection ready.');

    imap.openBox('INBOX', false, async (err, box) => {
      if (err) {
        console.error('Error opening inbox:', err);
        return;
      }

      await checkEmails(imap);
      console.log('Process completed, restarting...');
      setTimeout(startProcess, 1000); // Restart the process after 1 second
    });
  });

  imap.once('error', (err) => {
    console.error('IMAP error:', err);
    process.exit(1)
  });

  imap.once('end', () => {
    console.log('IMAP connection ended.');
    setTimeout(startProcess, 1000); // Restart the process after 1 second when ended
  });

  imap.connect();
};
// END COPAS 

// Start the process
startProcess();