# Lesson 13: Can it carry 10,000 students? (load test and capacity)

Last updated: 2026-10-16. Read this before the sports month and again before you resize the server.

Where each command runs is written in brackets: **[laptop]**, **[server]** (your EC2 server), **[load machine]** (the computer that pretends to be the students).

---

## 1. The honest short answer

| Question | Answer |
|---|---|
| Can the software handle 10,000 students at once? | **Yes, if the server has enough memory.** The code is not the limit. |
| What is the limit? | **Memory**, not speed. Every student who is connected costs memory in Caddy (the web server in front of your app). |
| Does a `t3.micro` (1 GiB) work for 10,000? | **No.** The stack itself already needs about 700 MB. It can serve about 600 to 2,700 students at the same moment, depending on how much memory your idle server uses. |
| Does a `t3.small` (2 GiB)? | **Borderline.** About 10,000 students if 60% only browse the home page and 40% watch live matches, but with almost no spare memory. Fine for 5,000. |
| Does a 4 GiB server (`t3.medium`, or a free-plan `c7i-flex.large`)? | **Yes, comfortably**, even if all 10,000 watch live. |
| How many students are really online at the same time? | Usually 20 to 40% of the college at the busiest moment: **2,000 to 4,000**. A `t3.small` is enough for that. |
| Have I proved it on your server? | **No.** I measured the costs on a test machine and calculated. Section 5 shows how to run the real test on your own server. Only that test is proof. |

---

## 2. What I measured (and what I assumed)

Measured with the real software chain (Caddy with HTTPS, then your Node app, Postgres and Redis) on a test machine with 1 CPU core and 4 GB of memory. The same machine also ran the pretend students, so speeds are pessimistic, but **memory numbers do not depend on CPU speed**.

| Measured | Result |
|---|---|
| Memory of one student who watches a live match (WebSocket) | Caddy **about 133 KB**, Node about 9 KB |
| Memory of one student who only browses (open HTTPS connection) | Caddy **about 45 KB**, Node about 0 |
| Home page answer size (122 matches) | **2.2 KB** on the wire (compressed) |
| CPU for one home page refresh | **about 1.06 ms** (Node 0.59 + Caddy 0.47) |
| CPU for one brand-new HTTPS visitor | about 1.1 ms (Caddy 0.82 + Node 0.30) |
| CPU to push one score update to one watcher | about 40 microseconds (so 2,000 watchers cost about 80 ms) |
| CPU of 6,000 idle live connections | about 4.4% of one core |
| Making Caddy clean up memory sooner (`GOGC=20`) | saves only about 12%: not worth it |

**Not measured, only assumed** (check these on your server, see 5.1):
- Ubuntu + Docker use about 400 MB.
- Postgres uses about 150 MB, Redis about 10 MB.

**Why Caddy is the big one:** for every live WebSocket, Caddy keeps an encrypted connection to the browser, a second connection to your app, and buffers in both directions. Your Node app is cheap (9 KB). The 3 changes in this lesson reduce the CPU cost (see section 6), but the memory per connection is a fact of the design.

---

## 3. What fits on which server

Formula (memory in MB):

```
used = fixed + 0.045 x (students only browsing) + 0.149 x (students watching live)
fixed = about 730   (Node 124 + Caddy 47 + Postgres 150 + Redis 10 + Ubuntu and Docker 400)
```
Replace `fixed` with the number measured on your server (section 5.1). Keep the result under **85% of the memory that is really available** (RAM minus about 100 MB).

| Students online at the same time | Memory needed | CPU needed | Data out in 3 hours | t3.micro 1 GiB | t3.small 2 GiB | 4 GiB server |
|---|---|---|---|---|---|---|
| 1,000 (40% live) | about 820 MB | 0.07 vCPU | 1.4 GB | no | ok | ok |
| 3,000 (40% live), a normal busy moment | about 990 MB | 0.21 vCPU | 4.3 GB | no | ok | ok |
| 5,000 (40% live) | about 1,160 MB | 0.34 vCPU | 7.1 GB | no | ok | ok |
| 10,000 (40% live) | about 1,600 MB | 0.69 vCPU | 14 GB | no | tight (about 82% of the usable memory) | ok |
| 10,000 all on the home page | about 1,180 MB | 1.06 vCPU | 24 GB | no | ok | ok |
| 10,000 all watching live (worst case) | about 2,220 MB | low | small | no | **no** | ok |

Room for students with a 60% browse / 40% live mix (using the assumed 730 MB): `t3.micro` about 600 (about 1,600 if your idle server uses 650 MB, about 2,700 if it uses 550 MB), `t3.small` about 10,000, 4 GiB about 30,000.

CPU notes:
- 1 vCPU = one core. A `t3` has 2. At 10,000 students you need about 0.7 vCPU for a few hours.
- A `t3` earns CPU slowly (`t3.micro` 0.2 vCPU, `t3.small` 0.4 vCPU on average) and by default runs in **unlimited mode**: it keeps full speed and AWS bills the extra CPU time per vCPU-hour. For a 3 hour event this is cents (check the current price and your credit setting in the console: Instance, Actions, Instance settings, Change credit specification).
- The CPU numbers assume your server core is about as fast as my test core. Treat them as +/- 50%.

---

## 4. Free tier: which server can you use?

It depends on **when your AWS account was created**:

| Account created | Free instance types | What to do |
|---|---|---|
| **On or after 15 July 2025** (the "free plan" with credits) | `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, **`c7i-flex.large`**, **`m7i-flex.large`** | For event days choose `c7i-flex.large` (2 vCPU, 4 GiB) or `m7i-flex.large` (2 vCPU, 8 GiB). Check the numbers and that the type exists in your region (Mumbai) in the launch screen: filter "Free tier eligible". Credits are used up faster by bigger types. |
| **Before 15 July 2025** (12-month free tier) | only `t2.micro` and `t3.micro` | `t3.micro` cannot carry the event. Use a bigger type for the event days only and pay for the hours: `t3.small` is about $0.022 per hour and `t3.medium` about $0.045 per hour in Mumbai (check the price page). 10 event days of 6 hours on `t3.medium` is about $3. |

To see the types your account may use for free: in the EC2 launch screen filter "Free tier eligible", or run `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true --query "InstanceTypes[*].[InstanceType]" --output text | sort`.

Other free-tier limits that matter for the event:
- **Data out to the internet:** the first 100 GB per month is free. A very busy 3 hour event is about 14 to 24 GB (table above). Several full events in one month can reach the limit.
- **Disk:** gp3 disks are free-tier eligible (30 GB).
- Keep the **budget alarm** from Lesson 8.

---

## 5. Run the real test on your own server

The pretend students come from another machine, over the real internet path (HTTPS), against your real server. Do this at a quiet time, not during real use.

### 5.1 Prepare the server [server]
```bash
cd ~/dreamcometrue
git pull
docker compose up -d --build
./scripts/backup.sh
./scripts/snapshot.sh | sed -n '/== server size ==/,/== code version ==/p'
```
You see the **instance type**, the number of CPU cores and `free -m` (memory). Note the **used** memory of the idle server: that is your real `fixed` number.

Add the safety net (a swap file: when memory peaks, the server slows down instead of a container being killed):
```bash
./scripts/add-swap.sh
```
In a second terminal keep this running during the test:
```bash
./scripts/watch-load.sh 5
```
One line every 5 seconds with CPU, memory, swap, connections and the memory of each container. A line with `!!` means stop the test.

### 5.2 Prepare the load machine
- **Small test (up to about 1,000 students):** your laptop is fine (`--procs 1`).
- **Real test (2,000 to 10,000):** a second EC2 server **in the same region**, for example a `c7i-flex.large` or `t3.medium` (4 GiB), used for one hour and then **terminated**. A pretend student needs about 60 to 100 KB, so 10,000 need 1 GB or more. Open SSH for your IP in its security group. [load machine]:
```bash
sudo apt update && sudo apt install -y nodejs npm
mkdir ~/lt && cd ~/lt && npm init -y > /dev/null && npm install socket.io-client
ulimit -n 65535
```
Copy `loadtest-real.js` to it from your laptop: `scp -i key.pem loadtest-real.js ubuntu@<load machine address>:~/lt/`. Node 18 or newer is needed (the test file was tested on Node 22).

### 5.3 Practice run (nothing is sent)
```bash
node loadtest-real.js --url https://52.66.126.144 --users 2000 --admin-user admin --admin-pass x --dry-run
```
It prints the plan and stops.

### 5.4 Real runs, in steps. Stop at the first step that FAILs.
Keep the admin password out of your history:
```bash
export LT_ADMIN_USER=admin
read -s LT_ADMIN_PASS; export LT_ADMIN_PASS      # type the password, press Enter
```
| Step | Command | Run time |
|---|---|---|
| 1 | `node loadtest-real.js --url https://52.66.126.144 --users 500 --ramp 60 --hold 120 --scorers 4 --procs 1` | 3 min |
| 2 | `... --users 2000 --ramp 120 --hold 180 --scorers 6 --procs 2` | 5 min |
| 3 | `... --users 5000 --ramp 180 --hold 240 --scorers 8 --procs 2` | 7 min |
| 4 | `... --users 10000 --ramp 240 --hold 300 --scorers 10 --procs 3 --spike` | 9 min |

(`--spike` makes 40% of the students arrive within 15 seconds in the middle, like everybody opening the app when a final starts.)

What the pretend students do:
- they arrive over the ramp time; each stays about 8 minutes, then leaves and is replaced;
- 60% only browse: open the home page and refresh it every 10 seconds, sometimes the points table;
- 40% watch live: open a match page, download the socket script, connect like a browser (polling first, then WebSocket), join a match (a few matches are much more popular), sometimes switch match, sometimes lose the connection for a few seconds;
- scorers log in and enter a cricket ball every 6 to 12 seconds on test matches (named `LT ...`, competition `LOADTEST`, shown on the home page while the test runs);
- some watchers measure how long a score takes from the scorer's tap to the screen.

At the end it **deletes the test matches** and disables the test scorers. If you press Ctrl+C it cleans up too.

### 5.5 Stop rules while it runs
Stop the test (Ctrl+C) if the watcher script shows:
- `!! LOW MEMORY` (less than 150 MB available), or
- `!! USING SWAP` and the swap number keeps growing, or
- the test output shows errors above a few percent.

### 5.6 Read the result
Every 10 seconds you get a line like:
```
[120s] students 6000 (sockets 2410) | http 598/s, errors 0.0%, p50 12 p95 80 p99 190 ms | score p50 140 p95 310 max 600 ms (n=1200) | ack p95 45 ms | drops 0 | load machine: cpu 62% lag 12 ms mem 900 MB
```
and a final list of PASS / FAIL checks:

| Check | Meaning |
|---|---|
| load machine not overloaded | The numbers are only valid if the pretend students' computer was not the bottleneck. If it FAILs, use a bigger load machine or more `--procs`: **the result is not reliable**. |
| web requests: errors under 1%, p95 under 1000 ms, p99 under 3000 ms | The home page is fast and does not fail |
| live connections: failed connects and drops under 1% | WebSockets connect and stay |
| score reaches the watchers: p95 under 2000 ms, slowest under 5000 ms, missed under 1% | **Your original goal: a score on the screen in under 5 seconds** |

### 5.7 Also look at the AWS console (for `t3` servers)
EC2, your instance, Monitoring: **CPUUtilization**, **CPUCreditBalance** and **CPUSurplusCreditBalance**. A growing surplus means you are using more CPU than the baseline earns, which is billed per vCPU-hour (cents).

### 5.8 If a step FAILs
| Symptom | Likely cause | Fix |
|---|---|---|
| `LOW MEMORY`, swap grows, connects fail | Not enough memory | Bigger server (section 7). Check `fixed` from 5.1. |
| CPU of the server at 100%, slow home page | Server too small, or too many refreshes | Bigger server. You can also change the refresh time in `public/index.html` (`10000` to `15000`), which cuts the CPU by one third. |
| `load machine not overloaded` FAIL | The test computer is the problem | More `--procs`, more memory, more cores |
| Score delay over 2 s while CPU is high | Same as above | Same |
| Errors only at the start of a spike | A lot of new HTTPS connections at once | Usually fine; look at the p99 and at whether errors stop |
| `429` errors | The login limit (many scorer logins from one address) | Normal if you repeat quickly; wait 10 minutes or `docker compose restart app` |

---

## 6. What changed in the code this lesson

| Change | Why |
|---|---|
| `home.js` / `server.js`: the home and points-table answers are built **once** (JSON, compressed copy and ETag) and sent as they are | Before, every request was compressed again. Now one refresh costs about 1 ms of CPU, and the answer is 2.2 KB on the wire. A browser that already has the latest copy gets an empty "not modified" answer. |
| The timestamp was removed from the home answer | So the ETag only changes when something really changed |
| `loadtest-real.js` | A realistic traffic simulator (section 5) |
| `scripts/watch-load.sh`, `add-swap.sh`, `snapshot.sh` (now shows the server size) | Watch the server during a test, add a memory safety net, report the instance type |

Nothing else about scoring changed. All earlier tests still pass (unit tests, the 118-check server test, the 60-check page test).

---

## 7. Resize the server for the event days
1. [server] `./scripts/backup.sh`
2. AWS console, EC2, select the instance, **Instance state, Stop** (not terminate). The Elastic IP stays.
3. **Actions, Instance settings, Change instance type**: choose the bigger type (a free-plan type from section 4 if you can).
4. **Start**. The containers start by themselves (`restart: unless-stopped`).
5. [server] `./scripts/security-check.sh` and open the site.
6. After the event: stop, change back to the small type, start.

A stopped server does not pay for CPU, but the disk and the Elastic IP still cost a little.

---

## 8. Other ways to carry more students (later, if needed)
- **CloudFront in front of `/api/home`** (answers cached for a few seconds at the edge): the server would see a few requests per second instead of 1,000. This removes most of the browser connections and CPU from your server. It needs extra setup.
- Let Node serve the WebSockets directly (without Caddy in between) to save about 130 KB per live student. This needs the certificate inside Node: more work and more risk.
- A fixed limit on live viewers per match with the rest falling back to refreshing.

---

## 9. What was tested and what was not

**Tested on my side**
- The simulator against a real Caddy with HTTPS, a real database and Redis: 300 students, 2 worker processes, scorers, probes and a spike all ran, and cleanup left no test data.
- The simulator's overload check: on a machine that was too small it reported "load machine overloaded" and FAIL instead of a false PASS.
- Memory per connection up to 6,000 live WebSockets, 3,000 open browser connections, the CPU of refreshes, new HTTPS visitors and broadcasts (section 2).
- The new compressed answers (gzip, ETag, 304) directly and through Caddy: 32 checks.
- `watch-load.sh`, `add-swap.sh` and the new part of `snapshot.sh` with pretend system commands.
- All earlier test suites on the final code.

**Not tested**
- Your real server, your real network, real phones, Docker's own memory overhead (assumed 400 MB for OS plus Docker).
- A run with 10,000 live connections: my machine reached its own limits (Caddy needs 2 file handles per live connection and my sandbox allowed 20,000). The 10,000 figures are **calculated** from the measured per-connection costs (which were steady from 1,000 to 6,000).
- Node 18 on the load machine (the file was tested on Node 22).

---

## 10. Command cheat sheet
**[server]**
```bash
./scripts/snapshot.sh            # status report, now with the server size
./scripts/add-swap.sh            # memory safety net (once)
./scripts/watch-load.sh 5        # live view while testing
./scripts/security-check.sh
free -m
docker stats --no-stream
```
**[load machine]**
```bash
ulimit -n 65535
node loadtest-real.js --help
node loadtest-real.js --url https://<address> --users 2000 --ramp 120 --hold 180 --scorers 6 --procs 2
```
**Read-only test on your real matches (creates nothing, no scorers):**
```bash
node loadtest-real.js --url https://<address> --users 2000 --matches cr-1a2b3c,tt-4d5e6f --procs 2
```
