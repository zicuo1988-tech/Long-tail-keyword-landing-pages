# WordPress AI Content Automation Engine

A powerful, full-stack automation system that generates SEO-optimised content using Google AI (Gemini) and automatically publishes to WordPress. This engine streamlines the creation of long-tail keyword landing pages with AI-generated content, product integration, and seamless WordPress publishing.

## 🎯 Overview

This project is an end-to-end content automation solution designed for creating high-quality, SEO-focused landing pages. It combines the power of Google's Gemini AI for content generation with WordPress REST API integration for seamless publishing. The system intelligently matches products from WooCommerce, generates structured content based on a comprehensive knowledge base, and publishes fully formatted pages with proper SEO metadata.

## ✨ Key Features

### 🤖 AI-Powered Content Generation
- **Google Gemini Integration**: Utilises Google Gemini 2.5 Pro for high-quality content generation
- **SEO Optimisation**: Content is optimised for search engines with proper keyword density and structure
- **Knowledge Base Compliance**: Strict adherence to product knowledge base ensures accuracy
- **British English**: All content generated in British English with no Chinese characters
- **Multiple Title Types**: Supports 14+ title types including Purchase, Review, How-to, Best, Top Ranking, etc.

### 📝 Content Structure
- **Structured Format**: Enforces specific content structure (H1, intro, H2 headings, numbered lists, conclusion)
- **One-Screen Optimisation**: Concise, readable content that fits on one screen
- **Question-Based Headings**: SEO-friendly headings that directly answer user queries
- **Dynamic Length**: Adjustable content length based on selected template

### 🛍️ Product Integration
- **WooCommerce Integration**: Automatically fetches products from WooCommerce REST API
- **Smart Product Matching**: Intelligent keyword-based product search with relevance scoring
- **Product Filtering**: Filters out unwanted categories (Uncategorised, Payment Link, specific categories)
- **Randomised Display**: Displays unique products in rows (4 products per row)
- **Price Formatting**: Handles price ranges, sale prices, and strikethrough pricing

### 🎨 Template System
- **Three Built-in Templates**: 
  - Template 1: Title + Content + Products (default)
  - Template 2: Title + Description + Products + Content + Products
  - Template 3: Title + Description + Products + Content + Products + Extended Content (no word limit)
- **Card-Based Selection**: Visual template selector with preview images
- **Custom Templates**: Support for custom HTML templates with Handlebars syntax
- **Responsive Design**: Fully responsive templates optimised for desktop, laptop, tablet, and mobile

### 📊 User Experience
- **Visual Progress Bar**: Real-time progress tracking with percentage and status updates
- **Task Status Polling**: Asynchronous task processing with status updates
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Template Preview**: Full-screen preview of template designs before selection

### 🔐 WordPress Integration
- **REST API Support**: Full WordPress REST API integration
- **Elementor Support**: Optional Elementor HTML widget publishing
- **Custom URL Prefix**: Automatic `/luxury-life-guides/` URL prefix for new pages
- **SEO Metadata**: Automatic generation of meta descriptions, keywords, Open Graph, and structured data
- **Custom Fields**: Stores URL prefix and other metadata as custom fields

## 🏗️ Architecture

### Backend (Node.js + TypeScript)
- **Express Server**: RESTful API server with CORS support
- **Google AI Service**: Integration with Google Generative AI SDK
- **WordPress Service**: WordPress/WooCommerce REST API client
- **Template Renderer**: Handlebars-based template rendering engine
- **Task Management**: Asynchronous task processing with status tracking
- **API Key Management**: Rotating API keys with retry logic and error handling

### Frontend (Vanilla JavaScript)
- **Modern UI**: Clean, responsive interface with card-based design
- **Template Selector**: Visual template selection with preview functionality
- **Progress Tracking**: Real-time progress bar and detailed logs
- **Form Validation**: Client-side validation with error messages
- **Task Polling**: Automatic status polling with abort support

## 📦 Project Structure

```
├── backend/
│   ├── src/
│   │   ├── services/
│   │   │   ├── googleAi.ts          # Google AI content generation
│   │   │   ├── wordpress.ts         # WordPress API integration
│   │   │   ├── templateRenderer.ts  # Handlebars template rendering
│   │   │   └── apiKeyManager.ts     # API key rotation & management
│   │   ├── routes/
│   │   │   ├── generation.ts        # Page generation endpoint
│   │   │   └── tasks.ts             # Task status endpoint
│   │   ├── knowledgeBase.ts         # Product knowledge base
│   │   └── types.ts                 # TypeScript type definitions
│   └── package.json
├── frontend/
│   ├── index.html                   # Main application UI
│   ├── main.js                     # Frontend logic
│   ├── styles.css                  # Application styles
│   ├── default-template.html       # Template 1
│   ├── template-2.html             # Template 2
│   └── template-3.html             # Template 3
├── wordpress-url-rewrite.php       # WordPress URL rewrite plugin
└── package.json                     # Root package.json
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- WordPress site with REST API enabled
- WooCommerce plugin (for product integration)
- Google AI Studio API key(s)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd 长尾词落地页
   ```

2. **Install dependencies**
   ```bash
   npm run install:all
   ```

3. **Configure backend environment**
   ```bash
   cd backend
   # Create .env file with your Google AI API keys
   # See backend/.env.example for reference
   ```

4. **Start development servers**
   ```bash
   # From root directory
   npm run dev
   ```
   This starts:
   - Backend server on `http://localhost:4000`
   - Frontend server on `http://localhost:8080`

### WordPress Setup

1. Install the `wordpress-url-rewrite.php` plugin in your WordPress site
2. Ensure REST API is enabled
3. Create an Application Password for API authentication
4. Configure WooCommerce REST API (optional, for product integration)

## 📖 Usage

1. **Open the frontend**: Navigate to `http://localhost:8080`
2. **Configure backend URL**: Default is `http://localhost:4000`
3. **Enter WordPress credentials**: Site URL, username, and application password
4. **Select template**: Choose from three templates with visual preview
5. **Choose title type**: Select from 14+ title types (Purchase, Review, How-to, etc.)
6. **Enter keyword**: Input your long-tail keyword
7. **Optional**: Enter custom page title (auto-generated if empty)
8. **Submit**: Click "生成并发布" to start the generation process
9. **Monitor progress**: Watch the progress bar and logs for real-time updates
10. **Access published page**: Click the link in the success message

## 🎨 Template System

### Template Variables
Templates use Handlebars syntax with the following variables:
- `{{PAGE_TITLE}}` - Page title
- `{{PAGE_DESCRIPTION}}` - Page description (Template 2 & 3)
- `{{{AI_GENERATED_CONTENT}}}` - Main AI-generated content
- `{{{AI_EXTENDED_CONTENT}}}` - Extended content (Template 3 only)
- `{{#each products}}` - Product loop
- `{{#each faqItems}}` - FAQ items loop
- SEO meta tags and structured data

### Custom Templates
You can upload custom HTML templates that follow the Handlebars syntax. The system will automatically render your template with the generated content and products.

## 🔧 Configuration

### Environment Variables (Backend)
```env
GOOGLE_AI_API_KEYS=key1,key2,key3
DEFAULT_MODEL=gemini-2.5-pro
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=http://proxy.example.com:8080
```

### API Key Management
The system supports multiple API keys with automatic rotation:
- Keys are rotated on rate limit (429) errors
- Exponential backoff retry logic
- Automatic fallback to next key

## 📊 Task Status Flow

1. **Pending** (0%) - Initial state
2. **Submitted** (10%) - Task submitted successfully
3. **Generating Title** (20%) - AI generating page title
4. **Generating Content** (40%) - AI generating article content
5. **Fetching Products** (60%) - Retrieving products from WooCommerce
6. **Generating HTML** (80%) - Rendering template with content
7. **Publishing** (90%) - Publishing to WordPress
8. **Completed** (100%) - Task completed successfully

## 🛡️ Error Handling

The system includes comprehensive error handling:
- **Network Errors**: Clear messages with troubleshooting steps
- **API Errors**: Detailed error messages with retry logic
- **WordPress Errors**: Specific error messages for authentication and publishing issues
- **Validation Errors**: Client-side and server-side validation

## 🔒 Security Features

- **API Key Rotation**: Multiple API keys with automatic rotation
- **WordPress Authentication**: Application password authentication
- **Input Validation**: Comprehensive input sanitisation
- **CORS Protection**: Configurable CORS settings
- **Error Sanitisation**: Sensitive information not exposed in errors

## 📈 SEO Features

- **Meta Tags**: Automatic generation of meta description and keywords
- **Structured Data**: JSON-LD for Article and FAQPage
- **Open Graph**: Social media sharing tags
- **Canonical URLs**: Proper canonical URL generation
- **H1/H2 Structure**: SEO-friendly heading hierarchy
- **Keyword Optimisation**: Proper keyword density and placement

## 🌐 Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## 📝 License

[Specify your license here]

## 🤝 Contributing

[Add contribution guidelines if applicable]

## 📧 Support

For issues and questions, please refer to the project documentation or create an issue in the repository.

---

**Built with**: Node.js, TypeScript, Express, Google Generative AI, WordPress REST API, Handlebars, Vanilla JavaScript

