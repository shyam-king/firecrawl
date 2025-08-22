import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import { chromium, Browser, BrowserContext, Route, Request as PlaywrightRequest, Page } from 'playwright';
import dotenv from 'dotenv';
import UserAgent from 'user-agents';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import { getError } from './helpers/get_error';

dotenv.config();

// Configure Winston logger with JSON formatter
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'playwright-scraper' },
  transports: [
    // Console transport with JSON format
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    // File transport with JSON format for all logs
    new winston.transports.File({ 
      filename: 'combined.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ],
});

// Extend Express Request interface to include correlationId
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

const app = express();
const port = process.env.PORT || 3003;

// Correlation ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  req.correlationId = uuidv4();
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

app.use(bodyParser.json());

const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';

const PROXY_SERVER = process.env.PROXY_SERVER || null;
const PROXY_USERNAME = process.env.PROXY_USERNAME || null;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || null;

const AD_SERVING_DOMAINS = [
  'doubleclick.net',
  'adservice.google.com',
  'googlesyndication.com',
  'googletagservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'adsystem.com',
  'adservice.com',
  'adnxs.com',
  'ads-twitter.com',
  'facebook.net',
  'fbcdn.net',
  'amazon-adsystem.com'
];

// Helper function to create contextual logger
const createLogger = (correlationId?: string) => {
  return logger.child({ correlationId });
};

interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
}

let browser: Browser;
let context: BrowserContext;

const initializeBrowser = async () => {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  const userAgent = new UserAgent().toString();
  const viewport = { width: 1280, height: 800 };

  const contextOptions: any = {
    userAgent,
    viewport,
  };

  if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
      username: PROXY_USERNAME,
      password: PROXY_PASSWORD,
    };
  } else if (PROXY_SERVER) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
    };
  }

  context = await browser.newContext(contextOptions);

  if (BLOCK_MEDIA) {
    await context.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', async (route: Route, request: PlaywrightRequest) => {
      await route.abort();
    });
  }

  // Intercept all requests to avoid loading ads
  await context.route('**/*', (route: Route, request: PlaywrightRequest) => {
    const requestUrl = new URL(request.url());
    const hostname = requestUrl.hostname;

    if (AD_SERVING_DOMAINS.some(domain => hostname.includes(domain))) {
      logger.info('Blocked ad serving domain', { hostname });
      return route.abort();
    }
    return route.continue();
  });

  isInitialized = true;
};

const shutdownBrowser = async () => {
  if (context) {
    await context.close();
  }
  if (browser) {
    await browser.close();
  }
};

const isValidUrl = (urlString: string): boolean => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

const scrapePage = async (page: Page, url: string, waitUntil: 'load' | 'networkidle', waitAfterLoad: number, timeout: number, checkSelector: string | undefined, correlationId?: string) => {
  const contextLogger = createLogger(correlationId);
  contextLogger.info('Navigating to page', { url, waitUntil, timeout });
  const response = await page.goto(url, { waitUntil, timeout });

  if (waitAfterLoad > 0) {
    await page.waitForTimeout(waitAfterLoad);
  }

  if (checkSelector) {
    try {
      await page.waitForSelector(checkSelector, { timeout });
    } catch (error) {
      throw new Error('Required selector not found');
    }
  }

  let headers = null, content = await page.content();
  let ct: string | undefined = undefined;
  if (response) {
    headers = await response.allHeaders();
    ct = Object.entries(headers).find(x => x[0].toLowerCase() === "content-type")?.[1];
    if (ct && (ct[1].includes("application/json") || ct[1].includes("text/plain"))) {
      content = (await response.body()).toString("utf8"); // TODO: determine real encoding
    }
  }

  return {
    content,
    status: response ? response.status() : null,
    headers,
    contentType: ct,
  };
};

let isInitialized = false;

app.get('/health', async (req: Request, res: Response) => {
  const contextLogger = createLogger(req.correlationId);
  
  try {
    contextLogger.info('Health check started');
    
    if (!browser || !context) {
      await initializeBrowser();
    }
    
    const testPage = await context.newPage();
    await testPage.close();
    
    contextLogger.info('Health check passed');
    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    contextLogger.info('Health check failed', { error: error instanceof Error ? error.message : 'Unknown error occurred' });
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
});



app.post('/scrape', async (req: Request, res: Response) => {
  if (!isInitialized) {
    return res.status(503).json({ status: 'unhealthy' });
  }

  const { url, wait_after_load = 0, timeout = 15000, headers, check_selector }: UrlModel = req.body;
  const contextLogger = createLogger(req.correlationId);

  contextLogger.info('Scrape request received', {
    url,
    wait_after_load,
    timeout,
    headers: headers || null,
    check_selector: check_selector || null
  });

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!PROXY_SERVER) {
    contextLogger.info('No proxy server provided. IP address may be blocked.');
  }

  if (!browser || !context) {
    await initializeBrowser();
  }

  const page = await context.newPage();

  // Set headers if provided
  if (headers) {
    await page.setExtraHTTPHeaders(headers);
  }

  let result: Awaited<ReturnType<typeof scrapePage>>;
  try {
    // Strategy 1: Normal
    contextLogger.info('Attempting scrape strategy 1: Normal load');
    result = await scrapePage(page, url, 'load', wait_after_load, timeout, check_selector, req.correlationId);
  } catch (error) {
    contextLogger.info('Strategy 1 failed, attempting strategy 2: Wait until networkidle', { error: error instanceof Error ? error.message : 'Unknown error' });
    try {
      // Strategy 2: Wait until networkidle
      result = await scrapePage(page, url, 'networkidle', wait_after_load, timeout, check_selector, req.correlationId);
    } catch (finalError) {
      contextLogger.info('Both scrape strategies failed', { error: finalError instanceof Error ? finalError.message : 'Unknown error' });
      await page.close();
      return res.status(500).json({ error: 'An error occurred while fetching the page.' });
    }
  }

  const pageError = result.status !== 200 ? getError(result.status) : undefined;

  if (!pageError) {
    contextLogger.info('Scrape completed successfully', { status: result.status });
  } else {
    contextLogger.info('Scrape completed with error', { status: result.status, pageError });
  }

  await page.close();

  res.json({
    content: result.content,
    pageStatusCode: result.status,
    contentType: result.contentType,
    ...(pageError && { pageError })
  });
});


app.listen(port, () => {
  initializeBrowser().then(() => {
    logger.info('Server started successfully', { port });
  }).catch((error) => {
    logger.info('Failed to initialize browser', { error: error instanceof Error ? error.message : 'Unknown error' });
  });
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  shutdownBrowser().then(() => {
    logger.info('Browser closed successfully');
    process.exit(0);
  }).catch((error) => {
    logger.info('Error during shutdown', { error: error instanceof Error ? error.message : 'Unknown error' });
    process.exit(1);
  });
});
