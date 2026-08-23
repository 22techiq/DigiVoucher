/***************************************************************
 * CORELYNK WIFI HOTSPOT
 * Google Apps Script Backend
 *
 * FRONTEND ACTIONS:
 *   startPayment
 *   checkPayment
 *
 * GOOGLE SHEETS:
 *   Packages
 *   Vouchers
 *   Transactions
 *
 * INTASEND:
 *   Live M-Pesa STK Push
 *
 * IMPORTANT:
 * 1. Put INTASEND_SECRET_KEY in Script Properties.
 * 2. Put your real Google Sheet ID below.
 * 3. Put your real IntaSend account email below.
 ***************************************************************/


/* =============================================================
   1. CONFIGURATION
============================================================= */

/*
 * Your Google Spreadsheet ID.
 *
 * Example:
 * https://docs.google.com/spreadsheets/d/ABC123/edit
 *
 * ID = ABC123
 */
const SPREADSHEET_ID =
  "YOUR_GOOGLE_SHEET_ID";


/*
 * Email registered with your IntaSend account.
 */
const INTASEND_EMAIL =
  "YOUR_INTASEND_ACCOUNT_EMAIL";


/*
 * IntaSend live collection endpoint.
 *
 * IMPORTANT:
 * This is backend-only.
 */
const INTASEND_STK_URL =
  "https://api.intasend.com/api/v1/payment/mpesa-stk-push/";


/*
 * IntaSend payment-status endpoint.
 */
const INTASEND_STATUS_URL =
  "https://api.intasend.com/api/v1/payment/status/";


/*
 * Secret key is NOT stored in this source code.
 *
 * Apps Script:
 *
 * Project Settings
 * → Script Properties
 *
 * Add:
 *
 * INTASEND_SECRET_KEY
 */
function getSecretKey() {

  return PropertiesService
    .getScriptProperties()
    .getProperty("INTASEND_SECRET_KEY");

}


/*
 * Sheet names.
 */
const SHEET_PACKAGES =
  "Packages";

const SHEET_VOUCHERS =
  "Vouchers";

const SHEET_TRANSACTIONS =
  "Transactions";


/*
 * Maximum time a payment can remain pending.
 */
const PAYMENT_TIMEOUT_MINUTES =
  10;


/* =============================================================
   2. GET REQUEST
============================================================= */

function doGet(e) {

  return json({

    success: true,

    service:
      "CoreLynk WiFi Payment API",

    status:
      "ONLINE",

    timestamp:
      new Date().toISOString()

  });

}


/* =============================================================
   3. POST REQUEST ROUTER
============================================================= */

function doPost(e) {

  try {

    if (
      !e ||
      !e.postData ||
      !e.postData.contents
    ) {

      return json({

        success: false,

        message:
          "Empty request."

      });

    }


    let request;

    try {

      request =
        JSON.parse(
          e.postData.contents
        );

    } catch (error) {

      return json({

        success: false,

        message:
          "Invalid JSON request."

      });

    }


    const action =
      String(
        request.action || ""
      ).trim();


    if (
      action ===
      "startPayment"
    ) {

      return startPayment(
        request
      );

    }


    if (
      action ===
      "checkPayment"
    ) {

      return checkPayment(
        request
      );

    }


    /*
     * Optional configuration test.
     */
    if (
      action ===
      "testConfiguration"
    ) {

      return testConfiguration();

    }


    return json({

      success: false,

      message:
        "Invalid API action."

    });

  }

  catch (error) {

    console.error(
      error.stack ||
      error
    );

    return json({

      success: false,

      message:
        "Backend error: " +
        error.message

    });

  }

}


/* =============================================================
   4. START PAYMENT
============================================================= */

function startPayment(request) {

  /*
   * Validate Google Sheet ID.
   */
  if (
    !SPREADSHEET_ID ||
    SPREADSHEET_ID ===
      "YOUR_GOOGLE_SHEET_ID"
  ) {

    return json({

      success: false,

      message:
        "Google Sheets ID has not been configured."

    });

  }


  /*
   * Validate IntaSend email.
   */
  if (
    !INTASEND_EMAIL ||
    INTASEND_EMAIL ===
      "YOUR_INTASEND_ACCOUNT_EMAIL"
  ) {

    return json({

      success: false,

      message:
        "IntaSend account email has not been configured."

    });

  }


  /*
   * Validate secret key.
   */
  const secretKey =
    getSecretKey();


  if (!secretKey) {

    return json({

      success: false,

      message:
        "INTASEND_SECRET_KEY is not configured in Script Properties."

    });

  }


  /*
   * Normalize phone.
   */
  const phone =
    normalizePhone(
      request.phone
    );


  if (!phone) {

    return json({

      success: false,

      message:
        "Please enter a valid Kenyan M-Pesa number."

    });

  }


  /*
   * Package selected by frontend.
   *
   * We do NOT trust the frontend price.
   */
  const packageName =
    String(
      request.packageName || ""
    ).trim();


  if (!packageName) {

    return json({

      success: false,

      message:
        "Please select a WiFi package."

    });

  }


  /*
   * Find package in Google Sheets.
   */
  const packageInfo =
    findPackage(
      packageName
    );


  if (!packageInfo) {

    return json({

      success: false,

      message:
        "Selected WiFi package does not exist or is inactive."

    });

  }


  /*
   * Check voucher stock BEFORE requesting payment.
   *
   * This prevents accepting payment when there is
   * no voucher available.
   */
  if (
    !voucherAvailable(
      packageName
    )
  ) {

    return json({

      success: false,

      message:
        "This package is currently sold out. Please choose another package."

    });

  }


  /*
   * Create unique reference.
   */
  const reference =
    createReference();


  /*
   * Create transaction record BEFORE calling IntaSend.
   */
  createTransaction({

    reference:
      reference,

    phone:
      phone,

    packageName:
      packageName,

    amount:
      packageInfo.price,

    invoiceId:
      "",

    status:
      "INITIATING",

    username:
      "",

    password:
      "",

    updatedAt:
      new Date(),

    createdAt:
      new Date()

  });


  /*
   * IntaSend STK payload.
   *
   * IntaSend's STK integration accepts
   * customer information, amount,
   * phone number, API reference, etc.
   */
  const payload = {

    first_name:
      "CoreLynk",

    last_name:
      "Customer",

    email:
      INTASEND_EMAIL,

    amount:
      packageInfo.price,

    phone_number:
      phone,

    currency:
      "KES",

    method:
      "MPESA_STK_PUSH",

    api_ref:
      reference,

    narrative:
      "CoreLynk WiFi - " +
      packageName

  };


  /*
   * Call IntaSend.
   */
  let response;

  try {

    response =
      UrlFetchApp.fetch(
        INTASEND_STK_URL,
        {

          method:
            "post",

          contentType:
            "application/json",

          headers: {

            Authorization:
              "Bearer " +
              secretKey,

            Accept:
              "application/json"

          },

          payload:
            JSON.stringify(
              payload
            ),

          muteHttpExceptions:
            true

        }
      );

  }

  catch (error) {

    updateTransaction(
      reference,
      {

        status:
          "INITIATION_FAILED",

        updatedAt:
          new Date()

      }
    );


    return json({

      success: false,

      message:
        "Unable to connect to IntaSend.",

      reference:
        reference

    });

  }


  const httpCode =
    response.getResponseCode();


  const responseText =
    response.getContentText();


  console.log(
    "INTASEND HTTP CODE: " +
    httpCode
  );


  console.log(
    "INTASEND RESPONSE: " +
    responseText
  );


  /*
   * Parse IntaSend response.
   */
  let result;

  try {

    result =
      JSON.parse(
        responseText
      );

  }

  catch (error) {

    updateTransaction(
      reference,
      {

        status:
          "INITIATION_FAILED",

        updatedAt:
          new Date()

      }
    );


    return json({

      success: false,

      message:
        "IntaSend returned an invalid response.",

      reference:
        reference,

      http_code:
        httpCode

    });

  }


  /*
   * Handle HTTP error.
   */
  if (
    httpCode < 200 ||
    httpCode >= 300
  ) {

    const errorMessage =
      getIntaSendError(
        result
      );


    updateTransaction(
      reference,
      {

        status:
          "INITIATION_FAILED",

        updatedAt:
          new Date()

      }
    );


    return json({

      success: false,

      message:
        errorMessage,

      reference:
        reference,

      http_code:
        httpCode

    });

  }


  /*
   * Extract invoice ID.
   */
  const invoiceId =
    getInvoiceId(
      result
    );


  if (!invoiceId) {

    updateTransaction(
      reference,
      {

        status:
          "INITIATION_FAILED",

        updatedAt:
          new Date()

      }
    );


    console.error(
      "IntaSend response contained no invoice ID:"
    );


    console.error(
      JSON.stringify(
        result
      )
    );


    return json({

      success: false,

      message:
        "IntaSend accepted the request but did not return an invoice ID.",

      reference:
        reference

    });

  }


  /*
   * Store invoice ID.
   */
  updateTransaction(
    reference,
    {

      invoiceId:
        invoiceId,

      status:
        "PENDING",

      updatedAt:
        new Date()

    }
  );


  /*
   * Return information to frontend.
   *
   * NEVER expose secret key.
   */
  return json({

    success:
      true,

    reference:
      reference,

    invoice_id:
      invoiceId,

    package:
      packageName,

    amount:
      packageInfo.price,

    status:
      "PENDING",

    message:
      "M-Pesa prompt sent. Please enter your M-Pesa PIN."

  });

}


/* =============================================================
   5. CHECK PAYMENT
============================================================= */

function checkPayment(request) {

  const reference =
    String(
      request.reference || ""
    ).trim();


  if (!reference) {

    return json({

      success: false,

      message:
        "Payment reference is missing."

    });

  }


  /*
   * Locate transaction.
   */
  const transaction =
    getTransaction(
      reference
    );


  if (!transaction) {

    return json({

      success: false,

      message:
        "Payment transaction was not found."

    });

  }


  /*
   * If already completed,
   * return the credentials.
   */
  if (
    transaction.status ===
    "COMPLETED"
  ) {

    return json({

      success:
        true,

      status:
        "COMPLETED",

      username:
        transaction.username,

      password:
        transaction.password

    });

  }


  /*
   * Check timeout.
   */
  const created =
    transaction.createdAt instanceof Date
      ? transaction.createdAt
      : new Date(
          transaction.createdAt
        );


  const elapsedMinutes =
    (
      new Date().getTime() -
      created.getTime()
    ) / 60000;


  if (
    elapsedMinutes >
    PAYMENT_TIMEOUT_MINUTES
  ) {

    updateTransaction(
      reference,
      {

        status:
          "TIMEOUT",

        updatedAt:
          new Date()

      }
    );


    return json({

      success:
        false,

      status:
        "TIMEOUT",

      message:
        "The payment request has expired. Please start a new payment."

    });

  }


  /*
   * No invoice yet.
   */
  if (
    !transaction.invoiceId
  ) {

    return json({

      success:
        false,

      status:
        "INITIATING",

      message:
        "Payment is being initiated."

    });

  }


  const secretKey =
    getSecretKey();


  if (!secretKey) {

    return json({

      success:
        false,

      status:
        "ERROR",

      message:
        "INTASEND_SECRET_KEY is not configured."

    });

  }


  /*
   * Query IntaSend status.
   */
  let response;

  try {

    response =
      UrlFetchApp.fetch(
        INTASEND_STATUS_URL,
        {

          method:
            "post",

          contentType:
            "application/json",

          headers: {

            Authorization:
              "Bearer " +
              secretKey,

            Accept:
              "application/json"

          },

          payload:
            JSON.stringify({

              invoice_id:
                transaction.invoiceId

            }),

          muteHttpExceptions:
            true

        }
      );

  }

  catch (error) {

    console.error(
      error
    );

    return json({

      success:
        false,

      status:
        "PENDING",

      message:
        "Waiting for payment confirmation."

    });

  }


  const httpCode =
    response.getResponseCode();


  const responseText =
    response.getContentText();


  console.log(
    "INTASEND STATUS HTTP: " +
    httpCode
  );


  console.log(
    "INTASEND STATUS RESPONSE: " +
    responseText
  );


  let result;

  try {

    result =
      JSON.parse(
        responseText
      );

  }

  catch (error) {

    return json({

      success:
        false,

      status:
        "PENDING",

      message:
        "Waiting for payment confirmation."

    });

  }


  /*
   * IntaSend status endpoint error.
   */
  if (
    httpCode < 200 ||
    httpCode >= 300
  ) {

    return json({

      success:
        false,

      status:
        "PENDING",

      message:
        "Payment status is temporarily unavailable."

    });

  }


  /*
   * Extract state.
   */
  const state =
    getPaymentState(
      result
    );


  console.log(
    "PAYMENT STATE: " +
    state
  );


  /*
   * ==========================================================
   * PAYMENT COMPLETE
   * ==========================================================
   */
  if (
    state ===
    "COMPLETE"
  ) {

    /*
     * Check if voucher has already been assigned.
     *
     * This prevents duplicate allocation.
     */
    const latestTransaction =
      getTransaction(
        reference
      );


    if (
      latestTransaction &&
      latestTransaction.status ===
      "COMPLETED"
    ) {

      return json({

        success:
          true,

        status:
          "COMPLETED",

        username:
          latestTransaction.username,

        password:
          latestTransaction.password

      });

    }


    /*
     * Allocate voucher.
     */
    const voucher =
      allocateVoucher(
        transaction.packageName,
        reference
      );


    if (!voucher) {

      updateTransaction(
        reference,
        {

          status:
            "PAID_NO_VOUCHER",

          updatedAt:
            new Date()

        }
      );


      return json({

        success:
          false,

        status:
          "COMPLETE_NO_VOUCHER",

        message:
          "Payment was successful, but this package is currently out of vouchers. Please contact CoreLynk Support."

      });

    }


    /*
     * Save voucher credentials.
     */
    updateTransaction(
      reference,
      {

        status:
          "COMPLETED",

        username:
          voucher.username,

        password:
          voucher.password,

        updatedAt:
          new Date()

      }
    );


    /*
     * Return credentials.
     */
    return json({

      success:
        true,

      status:
        "COMPLETED",

      username:
        voucher.username,

      password:
        voucher.password,

      message:
        "Payment confirmed. Voucher allocated successfully."

    });

  }


  /*
   * ==========================================================
   * PAYMENT FAILED
   * ==========================================================
   */
  if (
    state ===
      "FAILED"
  ) {

    updateTransaction(
      reference,
      {

        status:
          "FAILED",

        updatedAt:
          new Date()

      }
    );


    return json({

      success:
        false,

      status:
        "FAILED",

      message:
        "The M-Pesa payment was not completed."

    });

  }


  /*
   * PAYMENT STILL PROCESSING.
   */
  return json({

    success:
      false,

    status:
      state || "PENDING",

    message:
      "Waiting for M-Pesa payment confirmation."

  });

}


/* =============================================================
   6. FIND PACKAGE
============================================================= */

function findPackage(
  packageName
) {

  const ss =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );


  const sheet =
    ss.getSheetByName(
      SHEET_PACKAGES
    );


  if (!sheet) {

    throw new Error(
      "Packages sheet does not exist."
    );

  }


  const rows =
    sheet
      .getDataRange()
      .getValues();


  /*
   * Columns:
   *
   * A package
   * B price
   * C active
   */
  for (
    let i = 1;
    i < rows.length;
    i++
  ) {

    const name =
      String(
        rows[i][0]
      ).trim();


    const price =
      Number(
        rows[i][1]
      );


    const active =
      String(
        rows[i][2]
      )
      .trim()
      .toUpperCase();


    if (
      name === packageName &&
      active === "TRUE" &&
      price > 0
    ) {

      return {

        name:
          name,

        price:
          price

      };

    }

  }


  return null;

}


/* =============================================================
   7. CHECK VOUCHER STOCK
============================================================= */

function voucherAvailable(
  packageName
) {

  const ss =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );


  const sheet =
    ss.getSheetByName(
      SHEET_VOUCHERS
    );


  if (!sheet) {

    throw new Error(
      "Vouchers sheet does not exist."
    );

  }


  const rows =
    sheet
      .getDataRange()
      .getValues();


  /*
   * Columns:
   *
   * A username
   * B password
   * C package
   * D status
   */
  for (
    let i = 1;
    i < rows.length;
    i++
  ) {

    const packageInRow =
      String(
        rows[i][2]
      ).trim();


    const status =
      String(
        rows[i][3]
      )
      .trim()
      .toUpperCase();


    if (
      packageInRow === packageName &&
      status === "AVAILABLE"
    ) {

      return true;

    }

  }


  return false;

}


/* =============================================================
   8. ALLOCATE VOUCHER
============================================================= */

function allocateVoucher(
  packageName,
  transactionId
) {

  /*
   * Lock prevents two customers
   * receiving the same voucher.
   */
  const lock =
    LockService.getScriptLock();


  lock.waitLock(
    30000
  );


  try {

    const ss =
      SpreadsheetApp.openById(
        SPREADSHEET_ID
      );


    const sheet =
      ss.getSheetByName(
        SHEET_VOUCHERS
      );


    if (!sheet) {

      throw new Error(
        "Vouchers sheet does not exist."
      );

    }


    const rows =
      sheet
        .getDataRange()
        .getValues();


    for (
      let i = 1;
      i < rows.length;
      i++
    ) {

      const username =
        String(
          rows[i][0]
        ).trim();


      const password =
        String(
          rows[i][1]
        ).trim();


      const packageInRow =
        String(
          rows[i][2]
        ).trim();


      const status =
        String(
          rows[i][3]
        )
        .trim()
        .toUpperCase();


      if (
        packageInRow === packageName &&
        status === "AVAILABLE"
      ) {

        const row =
          i + 1;


        /*
         * Mark SOLD.
         */
        sheet
          .getRange(
            row,
            4
          )
          .setValue(
            "SOLD"
          );


        /*
         * Transaction reference.
         */
        sheet
          .getRange(
            row,
            5
          )
          .setValue(
            transactionId
          );


        /*
         * Assignment date.
         */
        sheet
          .getRange(
            row,
            6
          )
          .setValue(
            new Date()
          );


        return {

          username:
            username,

          password:
            password

        };

      }

    }


    return null;

  }

  finally {

    lock.releaseLock();

  }

}


/* =============================================================
   9. CREATE TRANSACTION
============================================================= */

function createTransaction(
  data
) {

  const ss =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );


  const sheet =
    ss.getSheetByName(
      SHEET_TRANSACTIONS
    );


  if (!sheet) {

    throw new Error(
      "Transactions sheet does not exist."
    );

  }


  /*
   * Columns:
   *
   * A reference
   * B phone
   * C package
   * D amount
   * E invoice_id
   * F status
   * G voucher
   * H username
   * I password
   * J updated_at
   * K created_at
   */
  sheet.appendRow([

    data.reference,

    data.phone,

    data.packageName,

    data.amount,

    data.invoiceId,

    data.status,

    "",

    data.username,

    data.password,

    data.updatedAt,

    data.createdAt

  ]);

}


/* =============================================================
   10. GET TRANSACTION
============================================================= */

function getTransaction(
  reference
) {

  const ss =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );


  const sheet =
    ss.getSheetByName(
      SHEET_TRANSACTIONS
    );


  if (!sheet) {

    throw new Error(
      "Transactions sheet does not exist."
    );

  }


  const rows =
    sheet
      .getDataRange()
      .getValues();


  for (
    let i = 1;
    i < rows.length;
    i++
  ) {

    if (
      String(
        rows[i][0]
      ).trim() === reference
    ) {

      return {

        row:
          i + 1,

        reference:
          rows[i][0],

        phone:
          rows[i][1],

        packageName:
          rows[i][2],

        amount:
          Number(
            rows[i][3]
          ),

        invoiceId:
          String(
            rows[i][4] || ""
          ).trim(),

        status:
          String(
            rows[i][5] || ""
          ).trim().toUpperCase(),

        username:
          rows[i][7],

        password:
          rows[i][8],

        updatedAt:
          rows[i][9],

        createdAt:
          rows[i][10]

      };

    }

  }


  return null;

}


/* =============================================================
   11. UPDATE TRANSACTION
============================================================= */

function updateTransaction(
  reference,
  updates
) {

  const ss =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );


  const sheet =
    ss.getSheetByName(
      SHEET_TRANSACTIONS
    );


  if (!sheet) {

    throw new Error(
      "Transactions sheet does not exist."
    );

  }


  const rows =
    sheet
      .getDataRange()
      .getValues();


  for (
    let i = 1;
    i < rows.length;
    i++
  ) {

    if (
      String(
        rows[i][0]
      ).trim() === reference
    ) {

      const row =
        i + 1;


      /*
       * Invoice ID
       */
      if (
        updates.invoiceId !==
        undefined
      ) {

        sheet
          .getRange(
            row,
            5
          )
          .setValue(
            updates.invoiceId
          );

      }


      /*
       * Status
       */
      if (
        updates.status !==
        undefined
      ) {

        sheet
          .getRange(
            row,
            6
          )
          .setValue(
            updates.status
          );

      }


      /*
       * Username
       */
      if (
        updates.username !==
        undefined
      ) {

        sheet
          .getRange(
            row,
            8
          )
          .setValue(
            updates.username
          );

      }


      /*
       * Password
       */
      if (
        updates.password !==
        undefined
      ) {

        sheet
          .getRange(
            row,
            9
          )
          .setValue(
            updates.password
          );

      }


      /*
       * Updated timestamp
       */
      if (
        updates.updatedAt !==
        undefined
      ) {

        sheet
          .getRange(
            row,
            10
          )
          .setValue(
            updates.updatedAt
          );

      }


      return true;

    }

  }


  return false;

}


/* =============================================================
   12. PHONE NORMALIZATION
============================================================= */

function normalizePhone(
  phone
) {

  if (!phone) {

    return null;

  }


  phone =
    String(phone)
      .trim()
      .replace(
        /\s+/g,
        ""
      )
      .replace(
        /-/g,
        ""
      );


  /*
   * 0712345678
   */
  if (
    /^07\d{8}$/.test(
      phone
    )
  ) {

    return (
      "254" +
      phone.substring(1)
    );

  }


  /*
   * 0112345678
   */
  if (
    /^01\d{8}$/.test(
      phone
    )
  ) {

    return (
      "254" +
      phone.substring(1)
    );

  }


  /*
   * +254712345678
   */
  if (
    /^\+254(7|1)\d{8}$/.test(
      phone
    )
  ) {

    return phone.substring(1);

  }


  /*
   * 254712345678
   */
  if (
    /^254(7|1)\d{8}$/.test(
      phone
    )
  ) {

    return phone;

  }


  return null;

}


/* =============================================================
   13. CREATE REFERENCE
============================================================= */

function createReference() {

  return (
    "CORELYNK-" +
    new Date()
      .getTime()
      .toString(36)
      .toUpperCase() +
    "-" +
    Utilities
      .getUuid()
      .substring(0, 8)
      .toUpperCase()
  );

}


/* =============================================================
   14. EXTRACT INVOICE ID
============================================================= */

function getInvoiceId(
  data
) {

  if (
    data &&
    data.invoice
  ) {

    if (
      data.invoice.invoice_id
    ) {

      return String(
        data.invoice.invoice_id
      );

    }


    if (
      data.invoice.id
    ) {

      return String(
        data.invoice.id
      );

    }

  }


  if (
    data &&
    data.invoice_id
  ) {

    return String(
      data.invoice_id
    );

  }


  if (
    data &&
    data.id
  ) {

    return String(
      data.id
    );

  }


  return null;

}


/* =============================================================
   15. PAYMENT STATE
============================================================= */

function getPaymentState(
  data
) {

  let state = "";


  if (
    data &&
    data.invoice &&
    data.invoice.state
  ) {

    state =
      data.invoice.state;

  }


  else if (
    data &&
    data.state
  ) {

    state =
      data.state;

  }


  else if (
    data &&
    data.status
  ) {

    state =
      data.status;

  }


  return String(
    state || "PENDING"
  )
    .trim()
    .toUpperCase();

}


/* =============================================================
   16. INTASEND ERROR
============================================================= */

function getIntaSendError(
  data
) {

  if (
    data &&
    data.detail
  ) {

    return String(
      data.detail
    );

  }


  if (
    data &&
    data.message
  ) {

    return String(
      data.message
    );

  }


  if (
    data &&
    data.error
  ) {

    return String(
      data.error
    );

  }


  if (
    data &&
    data.errors
  ) {

    return JSON.stringify(
      data.errors
    );

  }


  return (
    "IntaSend could not initiate the M-Pesa payment."
  );

}


/* =============================================================
   17. JSON RESPONSE
============================================================= */

function json(
  data
) {

  return ContentService
    .createTextOutput(
      JSON.stringify(
        data
      )
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );

}


/* =============================================================
   18. CONFIGURATION TEST
============================================================= */

function testConfiguration() {

  /*
   * Sheet ID.
   */
  if (
    !SPREADSHEET_ID ||
    SPREADSHEET_ID ===
      "YOUR_GOOGLE_SHEET_ID"
  ) {

    throw new Error(
      "SPREADSHEET_ID is not configured."
    );

  }


  /*
   * Email.
   */
  if (
    !INTASEND_EMAIL ||
    INTASEND_EMAIL ===
      "YOUR_INTASEND_ACCOUNT_EMAIL"
  ) {

    throw new Error(
      "INTASEND_EMAIL is not configured."
    );

  }


  /*
   * Secret key.
   */
  const secretKey =
    getSecretKey();


  if (!secretKey) {

    throw new Error(
      "INTASEND_SECRET_KEY is missing from Script Properties."
    );

  }


  /*
   * Open spreadsheet.
   */
  const ss =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );


  /*
   * Required sheets.
   */
  const packages =
    ss.getSheetByName(
      SHEET_PACKAGES
    );


  const vouchers =
    ss.getSheetByName(
      SHEET_VOUCHERS
    );


  const transactions =
    ss.getSheetByName(
      SHEET_TRANSACTIONS
    );


  if (!packages) {

    throw new Error(
      "Packages sheet missing."
    );

  }


  if (!vouchers) {

    throw new Error(
      "Vouchers sheet missing."
    );

  }


  if (!transactions) {

    throw new Error(
      "Transactions sheet missing."
    );

  }


  console.log(
    "================================"
  );

  console.log(
    "CORELYNK CONFIGURATION OK"
  );

  console.log(
    "Spreadsheet: " +
    ss.getName()
  );

  console.log(
    "Packages: OK"
  );

  console.log(
    "Vouchers: OK"
  );

  console.log(
    "Transactions: OK"
  );

  console.log(
    "IntaSend secret: OK"
  );

  console.log(
    "================================"
  );


  return {

    success:
      true,

    message:
      "CoreLynk configuration is OK."

  };

}


/* =============================================================
   19. SHEET CONNECTION TEST
============================================================= */

function testSheetConnection() {

  if (
    !SPREADSHEET_ID ||
    SPREADSHEET_ID ===
      "YOUR_GOOGLE_SHEET_ID"
  ) {

    throw new Error(
      "SPREADSHEET_ID is not configured."
    );

  }


  const ss =
    SpreadsheetApp.openById(
      SPREADSHEET_ID
    );


  console.log(
    "Spreadsheet: " +
    ss.getName()
  );


  console.log(
    "Packages: " +
    !!ss.getSheetByName(
      "Packages"
    )
  );


  console.log(
    "Vouchers: " +
    !!ss.getSheetByName(
      "Vouchers"
    )
  );


  console.log(
    "Transactions: " +
    !!ss.getSheetByName(
      "Transactions"
    )
  );

}


/* =============================================================
   20. MANUAL INTASEND CONNECTION TEST
============================================================= */

function testIntaSendConfiguration() {

  const secretKey =
    getSecretKey();


  if (!secretKey) {

    throw new Error(
      "INTASEND_SECRET_KEY is missing."
    );

  }


  if (
    !INTASEND_EMAIL ||
    INTASEND_EMAIL ===
      "YOUR_INTASEND_ACCOUNT_EMAIL"
  ) {

    throw new Error(
      "INTASEND_EMAIL is missing."
    );

  }


  console.log(
    "IntaSend endpoint:"
  );


  console.log(
    INTASEND_STK_URL
  );


  console.log(
    "IntaSend email:"
  );


  console.log(
    INTASEND_EMAIL
  );


  console.log(
    "Secret key configured: YES"
  );


  return {

    success:
      true,

    message:
      "IntaSend configuration is present."

  };

}