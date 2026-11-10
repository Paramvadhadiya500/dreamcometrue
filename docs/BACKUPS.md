# Backups: setup, off-server copy (S3), alert (heartbeat), restore drill

Everything here runs on the **Ubuntu server**, in `~/dreamcometrue`, unless it says "AWS console" or "browser".
Nothing in this guide touches the live database except the real restore in section 7.

## 1. What runs, and what protects you

| Job | When | What it does |
|---|---|---|
| `scripts/backup.sh` (cron) | every hour | Dumps the database to `~/backups/livescore-DATE-TIME.sql.gz`. Keeps the file ONLY if `check-backup.sh` says it is complete. Then copies it to S3 (if set) and pings the heartbeat (if set). On any failure: writes `FAILED: ...` to `~/backups/backup.log` and pings `<heartbeat>/fail`. Never touches older backups. |
| `scripts/prune-backups.sh` (cron) | daily 04:30 | Deletes local backups older than 7 days, but ALWAYS keeps the newest 3 complete ones. |
| S3 lifecycle rule | daily, by AWS | Deletes S3 copies older than 30 days. |
| Heartbeat (healthchecks.io) | always | Emails you if no successful backup arrived for about 2 hours, or at once on a `/fail` ping. |

Settings live in `~/.livescore-backup` (outside the project, never in Git, `chmod 600`):
```
BACKUP_S3_BUCKET=<your bucket name>
BACKUP_S3_REGION=ap-south-1
BACKUP_PING_URL=https://hc-ping.com/<your-uuid>
```
Both are optional: an empty or missing line simply switches that part off.

## 2. Install the new scripts (once)
```
./scripts/backup.sh                    # must print "Backup saved: ..."
./scripts/install-cron.sh              # hourly; puts back the backup line AND the new prune line
crontab -l | grep -v '^#'              # exactly 2 lines: livescore-backup and livescore-prune
./scripts/prune-backups.sh --dry-run   # shows what would be deleted; deletes nothing
```

## 3. Heartbeat alert (healthchecks.io, free) - about 5 minutes

1. Browser: open https://healthchecks.io and sign up with your email (free plan). Confirm the email link.
2. Click **Add Check**. Name it `livescore-backup`.
3. Click the check's schedule and set **Period = 1 hour**, **Grace time = 1 hour**. Save.
   (Meaning: a ping is expected every hour; you get an email if none arrived for 2 hours.)
4. Copy the **ping URL**. It looks like `https://hc-ping.com/1a2b3c4d-....` Treat it like a password: do not put it in Git or in chat.
5. Email alerts go to your sign-up address by default (see the **Integrations** page).
6. Server: put the URL in the settings file:
   ```
   nano ~/.livescore-backup
   ```
   add the line `BACKUP_PING_URL=https://hc-ping.com/<your-uuid>`, save (`Ctrl+O`, Enter, `Ctrl+X`), then:
   ```
   chmod 600 ~/.livescore-backup
   ./scripts/backup.sh
   ```
   The check on healthchecks.io must turn green ("up").
7. Test the alarm once: `curl -fsS "$(grep ^BACKUP_PING_URL= ~/.livescore-backup | cut -d= -f2-)/fail"`
   You must get a "DOWN" email within a minute. Then run `./scripts/backup.sh` again: you get an "UP" email.

**When you stop the server on purpose** (EC2 stopped for days): open the check and press **Pause**, or you will get a DOWN email. It starts again by itself with the next successful backup.

## 4. Off-server copy in S3 - about 20 minutes

The server gets permission to **upload only**, into one folder of one bucket. It cannot list, download or delete anything there. If the server is ever hacked, the copies in S3 are safe. AWS menu names may differ slightly from the words below.

### 4.1 Create the bucket (AWS console, region Asia Pacific (Mumbai) ap-south-1)
1. Open **S3** -> **Create bucket**.
2. **Bucket name**: something unique, lowercase, for example `dreamcometrue-backups-` followed by 6 random letters/digits.
3. **Region**: `ap-south-1`.
4. **Block all public access**: leave ON (all 4 boxes ticked).
5. **Bucket Versioning**: **Enable**. (If someone with server access uploads junk over an old file, S3 still keeps the real one.)
6. **Default encryption**: leave the default (SSE-S3).
7. **Create bucket**. Write the bucket name in your private notes.

### 4.2 Delete old copies automatically (lifecycle rule)
1. Open the bucket -> **Management** -> **Create lifecycle rule**.
2. Name: `delete-after-30-days`. Scope: **Limit the scope using filters**, Prefix: `backups/`.
3. Tick **Expire current versions of objects** -> 30 days.
4. Tick **Permanently delete noncurrent versions of objects** -> 30 days.
5. **Create rule**.

### 4.3 Give the server permission to upload (IAM role)
First check: **EC2** -> **Instances** -> your instance -> **Security** tab -> **IAM Role**.
- If it is **empty**, create a role (steps 1-4), then attach it (step 6).
- If a role is **already there**, skip to step 5 and add the policy to THAT role.

1. **IAM** -> **Roles** -> **Create role**.
2. Trusted entity type: **AWS service**. Use case: **EC2**. **Next**.
3. Add permissions: select **nothing**. **Next**.
4. Role name: `livescore-backup-role`. **Create role**.
5. Open the role -> **Permissions** -> **Add permissions** -> **Create inline policy** -> **JSON**. Paste this, with YOUR bucket name in place of `BUCKET-NAME`:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "UploadBackupsOnly",
         "Effect": "Allow",
         "Action": "s3:PutObject",
         "Resource": "arn:aws:s3:::BUCKET-NAME/backups/*"
       }
     ]
   }
   ```
   **Next**, policy name `upload-backups-only`, **Create policy**.
6. **EC2** -> **Instances** -> select your instance -> **Actions** -> **Security** -> **Modify IAM role** -> choose `livescore-backup-role` -> **Update IAM role**. (No restart needed.)

### 4.4 Install the AWS command line tool on the server
```
sudo snap install aws-cli --classic
aws --version
aws sts get-caller-identity
```
The last command must show an `Arn` that contains `assumed-role/livescore-backup-role/`. No keys are stored on the server: the role gives temporary access by itself.

### 4.5 Test the permission (replace BUCKET-NAME)
```
echo test > /tmp/s3test.txt
aws s3 cp /tmp/s3test.txt s3://BUCKET-NAME/backups/s3test.txt --region ap-south-1
aws s3 ls s3://BUCKET-NAME/ --region ap-south-1
```
- The `cp` must work (prints `upload: ...`).
- The `ls` must **fail** with `AccessDenied`. That is correct: the server may only upload.
- In the AWS console, delete `backups/s3test.txt` from the bucket.

### 4.6 Switch it on
```
nano ~/.livescore-backup
```
add:
```
BACKUP_S3_BUCKET=BUCKET-NAME
BACKUP_S3_REGION=ap-south-1
```
then:
```
./scripts/backup.sh
```
It must print `Backup saved: ...` AND `Copied to s3://BUCKET-NAME/backups/...`. Check that the file is in the bucket in the AWS console.

## 5. Check that everything is in place
```
./scripts/security-check.sh
```
In the "database and backups" part you want: `PASS newest backup is complete ...`, `PASS backups are copied off the server (S3)`, `PASS backup heartbeat alert is set`, `PASS old backups are pruned`.
Read failures in `tail -20 ~/backups/backup.log`.

## 6. Restore drill (safe, do it once a month and before every event)
```
./scripts/restore-drill.sh
```
It loads the newest backup into a separate scratch database `livescore_drill`, prints row counts next to the live counts, and deletes the scratch database again. The live database is only read (row counts), never changed. Pass = it prints `PASS` and the numbers are close (live can be a little higher).
To drill a backup downloaded from S3: copy it to the server (section 7, step 1) and run `./scripts/restore-drill.sh <file>`.

## 7. Real restore (replaces ALL live data)
Only when the live data is wrong or lost. Take a fresh backup first if the database still works (`./scripts/backup.sh`).
1. Pick the file. Local: `ls -lt ~/backups | head`. From S3 (server is gone or local copies are bad): AWS console -> bucket -> `backups/` -> select the file -> **Download**; copy it to the server from your laptop (PowerShell): `scp -i <key>.pem <file> ubuntu@<server-ip>:~/`
2. `./scripts/restore-drill.sh <file>` (proves the file loads, without touching live data).
3. `./scripts/restore.sh <file>` and type `yes`. It checks the file again before it deletes anything.
4. `curl -s http://localhost/health` and open the site.
