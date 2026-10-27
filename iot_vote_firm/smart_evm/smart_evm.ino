// Smart EVM booth firmware v2.0 (ESP32)
// Libraries: MFRC522, U8g2 (Arduino Library Manager). WiFi/HTTPClient come with the ESP32 core.
//
// Before flashing:
//   1. Set WIFI_NAME / WIFI_PASSWORD.
//   2. Set SERVER to your computer's IPv4 address (keep port 3000).
//   3. In the admin panel open Booths > Add booth, then paste DEVICE_ID and DEVICE_KEY below.

#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <U8g2lib.h>
#include <WiFi.h>
#include <HTTPClient.h>

// ---------- Network ----------
const char* WIFI_NAME     = "TP-Link_625C";
const char* WIFI_PASSWORD = "38340871";
const char* SERVER        = "http://192.168.0.109:3000";

// ---------- Booth identity (from the admin panel) ----------
// const char* DEVICE_ID  = "PASTE_DEVICE_ID";
// const char* DEVICE_KEY = "PASTE_DEVICE_KEY";

const char* DEVICE_ID = "booth-f56ec8";
const char* DEVICE_KEY = "bedd41384e41015a32fab9e1c3a811ff1967e93b0268a122";


#define FIRMWARE_VERSION "2.0"

// ---------- OLED ----------
#define OLED_SDA 16
#define OLED_SCL 17

U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(
  U8G2_R2,
  U8X8_PIN_NONE,
  OLED_SCL,
  OLED_SDA
);

// ---------- RFID ----------
#define SS_PIN   5
#define RST_PIN  4
#define SCK_PIN  25
#define MISO_PIN 26
#define MOSI_PIN 23

MFRC522 rfid(SS_PIN, RST_PIN);

// ---------- Buttons ----------
const int buttons[4] = {18, 19, 21, 22};

const char* options[4] = {
  "White - Option 1",
  "Red - Option 2",
  "Yellow - Option 3",
  "Green - Option 4"
};

int lastButtonState[4] = {HIGH, HIGH, HIGH, HIGH};

// ---------- Optional buzzer: set to a GPIO number to enable, -1 to disable ----------
const int BUZZER_PIN = -1;

// ---------- Timing ----------
const unsigned long VOTE_TIMEOUT_MS = 30000;     // pending vote is cancelled after this
const unsigned long HEARTBEAT_MS    = 10000;
const unsigned long RESULT_SHOW_MS  = 4000;

// ---------- State ----------
String currentUID = "";
String currentReqId = "";
bool waitingForVote = false;
unsigned long pendingSince = 0;
unsigned long lastHeartbeat = 0;
unsigned long idleAt = 0;

// ---------- Helpers ----------
void beep(int ms) {
  if (BUZZER_PIN < 0) return;
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}

void showScreen(
  const char* line1,
  const char* line2 = "",
  const char* line3 = "",
  const char* line4 = ""
) {
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);

  oled.drawStr(0, 10, "SMART EVM");
  oled.drawHLine(0, 13, 128);

  oled.drawStr(0, 26, line1);
  oled.drawStr(0, 38, line2);
  oled.drawStr(0, 50, line3);
  oled.drawStr(0, 62, line4);

  oled.sendBuffer();
}

void showIdle() {
  showScreen("Scan your ID card", "Ready to vote", "1 White  2 Red", "3 Yellow  4 Green");
}

// Show a result, then fall back to the idle screen after a few seconds.
void showResult(const char* l1, const char* l2 = "", const char* l3 = "", const char* l4 = "") {
  showScreen(l1, l2, l3, l4);
  idleAt = millis() + RESULT_SHOW_MS;
}

String readUID() {
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

String newReqId() {
  String s = "";
  for (int i = 0; i < 4; i++) {
    char b[9];
    snprintf(b, sizeof(b), "%08x", (unsigned int)esp_random());
    s += b;
  }
  return s;
}

// Reads a string value from flat JSON such as {"code":"OK","receipt":"K7F-29Q"}
String jsonField(const String& json, const char* key) {
  String needle = String("\"") + key + "\":\"";
  int start = json.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = json.indexOf('"', start);
  if (end < 0) return "";
  return json.substring(start, end);
}

// Returns the HTTP status, or -1 when the request could not be sent.
int postJSON(const char* path, const String& payload, String& response) {
  response = "";
  if (WiFi.status() != WL_CONNECTED) return -1;

  HTTPClient http;
  WiFiClient client;
  http.setTimeout(5000);

  String url = String(SERVER) + path;
  if (!http.begin(client, url)) return -1;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_KEY);

  int status = http.POST(payload);
  Serial.printf("POST %s -> %d\n", path, status);
  if (status > 0) {
    response = http.getString();
    Serial.println(response);
  }
  http.end();
  return status;
}

// ---------- Server calls ----------
// Returns the server's result code: OK, ALREADY_VOTED, NOT_REGISTERED, BLOCKED,
// NOT_OPEN, ENROLLED, DUPLICATE_CARD, BAD_DEVICE, or NETWORK / SERVER on failure.
String checkVoter(const String& uid) {
  String response;
  String payload = "{\"uid\":\"" + uid + "\"}";
  int status = postJSON("/api/device/check-voter", payload, response);
  if (status <= 0) return "NETWORK";
  String code = jsonField(response, "code");
  return code == "" ? "SERVER" : code;
}

// Returns true when the vote is stored. On failure, `code` holds the reason.
bool submitVote(const String& uid, int option, const String& reqId, String& receipt, String& code) {
  String response;
  String payload = "{\"uid\":\"" + uid + "\",\"option\":" + String(option) +
                   ",\"reqId\":\"" + reqId + "\"}";
  int status = postJSON("/api/device/vote", payload, response);
  if (status <= 0) { code = "NETWORK"; return false; }
  if (response.indexOf("\"success\":true") >= 0) {
    receipt = jsonField(response, "receipt");
    code = "OK";
    return true;
  }
  code = jsonField(response, "code");
  if (code == "") code = "SERVER";
  return false;
}

void sendHeartbeat() {
  String response;
  String payload = "{\"rssi\":" + String(WiFi.RSSI()) + ",\"fw\":\"" FIRMWARE_VERSION "\"}";
  postJSON("/api/device/heartbeat", payload, response);
}

void cancelPending() {
  waitingForVote = false;
  currentUID = "";
  currentReqId = "";
}

// ---------- Card handling ----------
void handleCard(const String& uid) {
  Serial.print("Scanned UID: ");
  Serial.println(uid);
  showScreen("Checking card...");

  String code = checkVoter(uid);

  if (code == "OK") {
    currentUID = uid;
    currentReqId = newReqId();
    waitingForVote = true;
    pendingSince = millis();
    beep(120);
    showScreen("Card accepted!", "Press ONE button", "1 White  2 Red", "3 Yellow  4 Green");
  } else if (code == "ALREADY_VOTED") {
    beep(700);
    showResult("ALREADY VOTED!", "Cannot vote again", "", "Scan another card");
  } else if (code == "NOT_REGISTERED") {
    beep(700);
    showResult("Card not registered", "Contact admin", "", "Scan another card");
  } else if (code == "BLOCKED") {
    beep(700);
    showResult("Card is blocked", "Contact admin", "", "Scan another card");
  } else if (code == "NOT_OPEN") {
    showResult("Voting is not open", "Ask the officer", "", "");
  } else if (code == "ENROLLED") {
    beep(200);
    showResult("CARD ENROLLED", "Registered by admin", "", "Voter can vote now");
  } else if (code == "DUPLICATE_CARD") {
    beep(700);
    showResult("Enroll failed", "Card or ID already", "registered", "");
  } else if (code == "BAD_DEVICE") {
    beep(700);
    showResult("Booth not authorized", "Check DEVICE_ID and", "DEVICE_KEY in the", "firmware");
  } else {
    beep(700);
    showResult("Connection error", "Vote not accepted", "Retry card scan", "");
  }
}

// ---------- Vote handling ----------
void handleVote(int i) {
  showScreen("Submitting vote...");
  Serial.print("Submitting option ");
  Serial.println(i + 1);

  String receipt, code;
  if (submitVote(currentUID, i + 1, currentReqId, receipt, code)) {
    Serial.println("Vote saved");
    beep(250);
    String rline = "Receipt: " + receipt;
    showResult("VOTE RECORDED!", options[i], rline.c_str(), "Scan next card");
    cancelPending();
  } else if (code == "ALREADY_VOTED" || code == "NOT_REGISTERED" || code == "NOT_OPEN") {
    beep(700);
    showResult("Vote rejected", code.c_str(), "", "Scan another card");
    cancelPending();
  } else {
    // Network trouble: keep the pending vote. The same reqId is reused, so a retry
    // can never count twice.
    Serial.println("Vote not confirmed");
    beep(400);
    showScreen("Vote not confirmed", "Release button", "Press again to retry", "");
  }
}

void setup() {
  Serial.begin(115200);

  Wire.begin(OLED_SDA, OLED_SCL);
  oled.begin();
  showScreen("Starting system...");

  for (int i = 0; i < 4; i++) pinMode(buttons[i], INPUT_PULLUP);
  if (BUZZER_PIN >= 0) pinMode(BUZZER_PIN, OUTPUT);

  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);
  rfid.PCD_Init();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  showScreen("Connecting Wi-Fi...");
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  sendHeartbeat();
  lastHeartbeat = millis();
  showIdle();
}

void loop() {
  // Keep Wi-Fi alive without blocking the booth.
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastTry = 0;
    if (millis() - lastTry > 10000) {
      lastTry = millis();
      WiFi.reconnect();
    }
  }

  // Heartbeat tells the admin panel this booth is online.
  if (!waitingForVote && millis() - lastHeartbeat > HEARTBEAT_MS) {
    lastHeartbeat = millis();
    sendHeartbeat();
  }

  // Return to the idle screen after a result has been shown.
  if (idleAt && millis() > idleAt && !waitingForVote) {
    idleAt = 0;
    showIdle();
  }

  // Cancel a vote nobody finished.
  if (waitingForVote && millis() - pendingSince > VOTE_TIMEOUT_MS) {
    cancelPending();
    showResult("Timed out", "Vote not recorded", "Scan your card", "again to vote");
  }

  // 1. Scan a card only when no vote is pending.
  if (!waitingForVote &&
      rfid.PICC_IsNewCardPresent() &&
      rfid.PICC_ReadCardSerial()) {
    handleCard(readUID());
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  // 2. Read button presses.
  for (int i = 0; i < 4; i++) {
    int state = digitalRead(buttons[i]);
    if (waitingForVote && state == LOW && lastButtonState[i] == HIGH) {
      delay(30);  // debounce
      if (digitalRead(buttons[i]) == LOW) handleVote(i);
    }
    lastButtonState[i] = state;
  }
}
