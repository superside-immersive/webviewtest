import * as THREE from 'three';

const EPSILON = 1e-6;

const POSE_INDEX = Object.freeze({
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
});

const DEFAULT_OPTIONS = Object.freeze({
  visibilityThreshold: 0.35,
  presenceThreshold: 0.15,
  rotationSpeed: 12,
  spineFollow: 0.55,
  chestFollow: 0.8,
  upperChestFollow: 0.85,
  neckFollow: 0.65,
  headFollow: 1.0,
  footFollow: 0.8,
  lostTrackingHoldMs: 180,
});

const IDENTITY_QUATERNION = new THREE.Quaternion();

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function computeLerpFactor(speed, deltaSeconds) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 0;
  }

  return 1 - Math.exp(-Math.max(0.01, speed) * deltaSeconds);
}

function isReliableLandmark(landmark, options) {
  if (!landmark) {
    return false;
  }

  if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y) || !Number.isFinite(landmark.z ?? 0)) {
    return false;
  }

  if (landmark.visibility != null && landmark.visibility < options.visibilityThreshold) {
    return false;
  }

  if (landmark.presence != null && landmark.presence < options.presenceThreshold) {
    return false;
  }

  return true;
}

function normalizeVector(vector) {
  const lengthSq = vector.lengthSq();
  if (!Number.isFinite(lengthSq) || lengthSq <= EPSILON) {
    return false;
  }

  vector.multiplyScalar(1 / Math.sqrt(lengthSq));
  return true;
}

function quaternionFromLookRotation(forward, up, targetQuaternion) {
  const zAxis = forward.clone();
  if (!normalizeVector(zAxis)) {
    return null;
  }

  const xAxis = new THREE.Vector3().crossVectors(up, zAxis);
  if (!normalizeVector(xAxis)) {
    return null;
  }

  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  if (!normalizeVector(yAxis)) {
    return null;
  }

  const matrix = new THREE.Matrix4();
  matrix.makeBasis(xAxis, yAxis, zAxis);
  return targetQuaternion.setFromRotationMatrix(matrix).normalize();
}

function projectWorldLandmark(target, landmark) {
  return target.set(landmark.x, -landmark.y, landmark.z ?? 0);
}

function projectNormalizedLandmark(target, landmark) {
  return target.set(landmark.x - 0.5, 0.5 - landmark.y, -(landmark.z ?? 0));
}

function composeWithRestWorld(deltaRotation, restWorldRotation) {
  if (!deltaRotation || !restWorldRotation) {
    return null;
  }

  return deltaRotation.clone().multiply(restWorldRotation).normalize();
}

function uniquePush(array, item) {
  if (item && !array.includes(item)) {
    array.push(item);
  }
}

function createAimData(retargeter, boneName, childName) {
  const bone = retargeter.getBoneNode(boneName);
  const child = retargeter.getBoneNode(childName);
  if (!bone || !child) {
    return null;
  }

  bone.updateWorldMatrix(true, true);
  child.updateWorldMatrix(true, false);

  const bonePosition = new THREE.Vector3();
  const childPosition = new THREE.Vector3();
  bone.getWorldPosition(bonePosition);
  child.getWorldPosition(childPosition);

  const restDirectionWorld = childPosition.sub(bonePosition);
  if (!normalizeVector(restDirectionWorld)) {
    return null;
  }

  const parentWorldRotation = bone.parent
    ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
    : IDENTITY_QUATERNION.clone();

  const restDirectionLocal = restDirectionWorld.clone().applyQuaternion(parentWorldRotation.clone().invert());
  if (!normalizeVector(restDirectionLocal)) {
    return null;
  }

  return {
    bone,
    child,
    restDirectionLocal,
    initialLocalRotation: bone.quaternion.clone(),
    initialWorldRotation: bone.getWorldQuaternion(new THREE.Quaternion()),
  };
}

export class VrmBodyRetargetLite {
  constructor(vrm, options = {}) {
    this.vrm = vrm;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.bones = {};
    this.restLocal = {};
    this.restWorld = {};
    this.aims = {};
    this.controlledBones = [];
    this.lastTrackedAt = 0;

    this._cacheRig();

    if (this.vrm?.humanoid) {
      this.vrm.humanoid.autoUpdateHumanBones = true;
    }
  }

  getBoneNode(name) {
    if (!name || !this.vrm?.humanoid) {
      return null;
    }

    try {
      return this.vrm.humanoid.getNormalizedBoneNode(name) || this.vrm.humanoid.getRawBoneNode(name);
    } catch {
      try {
        return this.vrm.humanoid.getRawBoneNode(name);
      } catch {
        return null;
      }
    }
  }

  update(result, deltaSeconds) {
    const poseData = this._extractPoseData(result);
    if (!poseData) {
      this._handleTrackingLoss(deltaSeconds);
      return { tracked: false, source: 'none', landmarkCount: 0 };
    }

    this.lastTrackedAt = performance.now();
    this._applyBody(poseData, computeLerpFactor(this.options.rotationSpeed, deltaSeconds));

    return {
      tracked: true,
      source: poseData.kind,
      landmarkCount: poseData.landmarks.length,
    };
  }

  updateFromLandmarks(landmarks, deltaSeconds, kind = 'world') {
    if (!Array.isArray(landmarks) || landmarks.length === 0) {
      this._handleTrackingLoss(deltaSeconds);
      return { tracked: false, source: 'none', landmarkCount: 0 };
    }

    const poseData = {
      kind,
      landmarks,
      projector: kind === 'world' ? projectWorldLandmark : projectNormalizedLandmark,
    };

    this.lastTrackedAt = performance.now();
    this._applyBody(poseData, computeLerpFactor(this.options.rotationSpeed, deltaSeconds));

    return {
      tracked: true,
      source: poseData.kind,
      landmarkCount: poseData.landmarks.length,
    };
  }

  _cacheBone(name, aliases = []) {
    const candidateNames = [name, ...aliases];
    const bone = candidateNames.map((candidate) => this.getBoneNode(candidate)).find(Boolean);
    if (!bone) {
      return null;
    }

    bone.updateWorldMatrix(true, false);
    this.bones[name] = bone;
    this.restLocal[name] = bone.quaternion.clone();
    this.restWorld[name] = bone.getWorldQuaternion(new THREE.Quaternion());
    uniquePush(this.controlledBones, bone);
    return bone;
  }

  _cacheRig() {
    this._cacheBone('hips');
    this._cacheBone('spine');
    this._cacheBone('chest', ['upperChest']);
    this._cacheBone('upperChest');
    this._cacheBone('neck');
    this._cacheBone('head');

    this._cacheBone('leftUpperArm');
    this._cacheBone('leftLowerArm');
    this._cacheBone('leftHand');
    this._cacheBone('rightUpperArm');
    this._cacheBone('rightLowerArm');
    this._cacheBone('rightHand');

    this._cacheBone('leftUpperLeg');
    this._cacheBone('leftLowerLeg');
    this._cacheBone('leftFoot');
    this._cacheBone('leftToes');
    this._cacheBone('rightUpperLeg');
    this._cacheBone('rightLowerLeg');
    this._cacheBone('rightFoot');
    this._cacheBone('rightToes');

    this.aims.leftUpperArm = createAimData(this, 'leftUpperArm', 'leftLowerArm');
    this.aims.leftLowerArm = createAimData(this, 'leftLowerArm', 'leftHand');
    this.aims.rightUpperArm = createAimData(this, 'rightUpperArm', 'rightLowerArm');
    this.aims.rightLowerArm = createAimData(this, 'rightLowerArm', 'rightHand');

    this.aims.leftUpperLeg = createAimData(this, 'leftUpperLeg', 'leftLowerLeg');
    this.aims.leftLowerLeg = createAimData(this, 'leftLowerLeg', 'leftFoot');
    this.aims.rightUpperLeg = createAimData(this, 'rightUpperLeg', 'rightLowerLeg');
    this.aims.rightLowerLeg = createAimData(this, 'rightLowerLeg', 'rightFoot');

    this.aims.leftFoot = createAimData(this, 'leftFoot', 'leftToes');
    this.aims.rightFoot = createAimData(this, 'rightFoot', 'rightToes');
  }

  _extractPoseData(result) {
    const worldLandmarks = result?.worldLandmarks?.[0];
    if (Array.isArray(worldLandmarks) && worldLandmarks.length > 0) {
      return { kind: 'world', landmarks: worldLandmarks, projector: projectWorldLandmark };
    }

    const normalizedLandmarks = result?.landmarks?.[0];
    if (Array.isArray(normalizedLandmarks) && normalizedLandmarks.length > 0) {
      return { kind: 'normalized', landmarks: normalizedLandmarks, projector: projectNormalizedLandmark };
    }

    return null;
  }

  _getLandmarkVector(poseData, index, target) {
    const landmark = poseData.landmarks[index];
    if (!isReliableLandmark(landmark, this.options)) {
      return null;
    }

    return poseData.projector(target, landmark);
  }

  _applyBody(poseData, lerpFactor) {
    if (!poseData || lerpFactor <= 0) {
      return;
    }

    const torsoState = this._applyTorso(poseData, lerpFactor);

    this._applyParentRelativeLimbChain(
      poseData,
      this.aims.leftUpperArm,
      this.aims.leftLowerArm,
      POSE_INDEX.leftShoulder,
      POSE_INDEX.leftElbow,
      POSE_INDEX.leftWrist,
      lerpFactor,
    );
    this._applyParentRelativeLimbChain(
      poseData,
      this.aims.rightUpperArm,
      this.aims.rightLowerArm,
      POSE_INDEX.rightShoulder,
      POSE_INDEX.rightElbow,
      POSE_INDEX.rightWrist,
      lerpFactor,
    );
    this._applyParentRelativeLimbChain(
      poseData,
      this.aims.leftUpperLeg,
      this.aims.leftLowerLeg,
      POSE_INDEX.leftHip,
      POSE_INDEX.leftKnee,
      POSE_INDEX.leftAnkle,
      lerpFactor,
    );
    this._applyParentRelativeLimbChain(
      poseData,
      this.aims.rightUpperLeg,
      this.aims.rightLowerLeg,
      POSE_INDEX.rightHip,
      POSE_INDEX.rightKnee,
      POSE_INDEX.rightAnkle,
      lerpFactor,
    );

    this._applyFootOverride(poseData, this.aims.leftFoot, POSE_INDEX.leftHeel, POSE_INDEX.leftFootIndex, lerpFactor * this.options.footFollow);
    this._applyFootOverride(poseData, this.aims.rightFoot, POSE_INDEX.rightHeel, POSE_INDEX.rightFootIndex, lerpFactor * this.options.footFollow);

    if (torsoState) {
      this._applyPoseDrivenHead(poseData, torsoState.shoulderMid, torsoState.forward, lerpFactor);
    }
  }

  _applyTorso(poseData, lerpFactor) {
    const leftHip = this._getLandmarkVector(poseData, POSE_INDEX.leftHip, new THREE.Vector3());
    const rightHip = this._getLandmarkVector(poseData, POSE_INDEX.rightHip, new THREE.Vector3());
    const leftShoulder = this._getLandmarkVector(poseData, POSE_INDEX.leftShoulder, new THREE.Vector3());
    const rightShoulder = this._getLandmarkVector(poseData, POSE_INDEX.rightShoulder, new THREE.Vector3());
    if (!leftHip || !rightHip || !leftShoulder || !rightShoulder) {
      return null;
    }

    const hipMid = leftHip.clone().add(rightHip).multiplyScalar(0.5);
    const shoulderMid = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);

    const torsoUp = shoulderMid.clone().sub(hipMid);
    if (!normalizeVector(torsoUp)) {
      return null;
    }

    const hipRight = rightHip.clone().sub(leftHip);
    if (!normalizeVector(hipRight)) {
      return null;
    }

    const forward = new THREE.Vector3().crossVectors(hipRight, torsoUp);
    if (!normalizeVector(forward)) {
      return null;
    }

    const rootUp = new THREE.Vector3().crossVectors(forward, hipRight);
    if (!normalizeVector(rootUp)) {
      return null;
    }

    const hipsDelta = quaternionFromLookRotation(forward, rootUp, new THREE.Quaternion());
    if (!hipsDelta) {
      return null;
    }

    this._slerpBoneWorld(
      this.bones.hips,
      composeWithRestWorld(hipsDelta, this.restWorld.hips),
      lerpFactor,
    );

    const shoulderRight = rightShoulder.clone().sub(leftShoulder);
    if (!normalizeVector(shoulderRight)) {
      shoulderRight.copy(hipRight);
    }

    const spineForward = new THREE.Vector3().crossVectors(shoulderRight, torsoUp);
    if (!normalizeVector(spineForward)) {
      return null;
    }

    const spineUp = new THREE.Vector3().crossVectors(spineForward, shoulderRight);
    if (!normalizeVector(spineUp)) {
      return null;
    }

    const spineDelta = quaternionFromLookRotation(spineForward, spineUp, new THREE.Quaternion());
    if (!spineDelta) {
      return null;
    }

    const spineWorld = composeWithRestWorld(spineDelta, this.restWorld.spine);
    const chestWorld = composeWithRestWorld(spineDelta, this.restWorld.chest);
    const upperChestWorld = composeWithRestWorld(spineDelta, this.restWorld.upperChest);

    this._slerpBoneWorld(this.bones.spine, spineWorld, lerpFactor * this.options.spineFollow);
    this._slerpBoneWorld(this.bones.chest, chestWorld, lerpFactor * this.options.chestFollow);
    this._slerpBoneWorld(this.bones.upperChest, upperChestWorld, lerpFactor * this.options.upperChestFollow);

    return {
      shoulderMid,
      forward,
    };
  }

  _applyPoseDrivenHead(poseData, shoulderMid, torsoForward, lerpFactor) {
    if (!shoulderMid || !torsoForward) {
      return;
    }

    const leftEar = this._getLandmarkVector(poseData, POSE_INDEX.leftEar, new THREE.Vector3());
    const rightEar = this._getLandmarkVector(poseData, POSE_INDEX.rightEar, new THREE.Vector3());
    let headUp;
    let headRight;

    if (leftEar && rightEar) {
      const earMid = leftEar.clone().add(rightEar).multiplyScalar(0.5);
      headUp = earMid.sub(shoulderMid);
      headRight = rightEar.sub(leftEar);
    } else {
      const nose = this._getLandmarkVector(poseData, POSE_INDEX.nose, new THREE.Vector3());
      if (!nose) {
        return;
      }

      const leftShoulder = this._getLandmarkVector(poseData, POSE_INDEX.leftShoulder, new THREE.Vector3());
      const rightShoulder = this._getLandmarkVector(poseData, POSE_INDEX.rightShoulder, new THREE.Vector3());
      if (!leftShoulder || !rightShoulder) {
        return;
      }

      headUp = nose.sub(shoulderMid.clone());
      headRight = rightShoulder.sub(leftShoulder);
    }

    if (!normalizeVector(headUp) || !normalizeVector(headRight)) {
      return;
    }

    const headForward = new THREE.Vector3().crossVectors(headRight, headUp);
    if (!normalizeVector(headForward)) {
      return;
    }

    if (headForward.dot(torsoForward) < 0) {
      headForward.negate();
    }

    const finalHeadUp = new THREE.Vector3().crossVectors(headForward, headRight);
    if (!normalizeVector(finalHeadUp)) {
      return;
    }

    const headDelta = quaternionFromLookRotation(headForward, finalHeadUp, new THREE.Quaternion());
    if (!headDelta) {
      return;
    }

    const neckWorld = composeWithRestWorld(headDelta, this.restWorld.neck);
    const headWorld = composeWithRestWorld(headDelta, this.restWorld.head);

    this._slerpBoneWorld(this.bones.neck, neckWorld, lerpFactor * this.options.neckFollow);
    this._slerpBoneWorld(this.bones.head, headWorld, lerpFactor * this.options.headFollow);
  }

  _applyParentRelativeLimbChain(poseData, upperAim, lowerAim, upperStart, upperEnd, lowerEnd, lerpFactor) {
    const upperResult = this._applyLocalAimFromPose(poseData, upperAim, upperStart, upperEnd, lerpFactor);
    this._applyLocalAimFromPose(poseData, lowerAim, upperEnd, lowerEnd, lerpFactor, upperResult?.worldRotation ?? null);
  }

  _applyLocalAimFromPose(poseData, aim, startIndex, endIndex, lerpFactor, parentWorldRotationOverride = null) {
    if (!aim?.bone) {
      return null;
    }

    const start = this._getLandmarkVector(poseData, startIndex, new THREE.Vector3());
    const end = this._getLandmarkVector(poseData, endIndex, new THREE.Vector3());
    if (!start || !end) {
      return null;
    }

    const targetDirection = end.sub(start);
    if (!normalizeVector(targetDirection)) {
      return null;
    }

    const parentWorldRotation = parentWorldRotationOverride
      ? parentWorldRotationOverride.clone()
      : (aim.bone.parent ? aim.bone.parent.getWorldQuaternion(new THREE.Quaternion()) : IDENTITY_QUATERNION.clone());

    const targetLocalDirection = targetDirection.clone().applyQuaternion(parentWorldRotation.clone().invert());
    if (!normalizeVector(targetLocalDirection)) {
      return null;
    }

    const delta = new THREE.Quaternion().setFromUnitVectors(aim.restDirectionLocal, targetLocalDirection);
    const targetLocalRotation = aim.initialLocalRotation.clone().premultiply(delta).normalize();
    const targetWorldRotation = parentWorldRotation.multiply(targetLocalRotation.clone()).normalize();

    aim.bone.quaternion.slerp(targetLocalRotation, clamp01(lerpFactor));
    aim.bone.updateMatrixWorld();

    return { worldRotation: targetWorldRotation };
  }

  _applyFootOverride(poseData, aim, heelIndex, toeIndex, lerpFactor) {
    if (!aim?.bone || lerpFactor <= 0) {
      return;
    }

    const heel = this._getLandmarkVector(poseData, heelIndex, new THREE.Vector3());
    const toe = this._getLandmarkVector(poseData, toeIndex, new THREE.Vector3());
    if (!heel || !toe) {
      return;
    }

    const targetDirection = toe.sub(heel);
    if (!normalizeVector(targetDirection)) {
      return;
    }

    const parentWorldRotation = aim.bone.parent
      ? aim.bone.parent.getWorldQuaternion(new THREE.Quaternion())
      : IDENTITY_QUATERNION.clone();

    const targetLocalDirection = targetDirection.clone().applyQuaternion(parentWorldRotation.clone().invert());
    if (!normalizeVector(targetLocalDirection)) {
      return;
    }

    const delta = new THREE.Quaternion().setFromUnitVectors(aim.restDirectionLocal, targetLocalDirection);
    const targetLocalRotation = aim.initialLocalRotation.clone().premultiply(delta).normalize();

    aim.bone.quaternion.slerp(targetLocalRotation, clamp01(lerpFactor));
    aim.bone.updateMatrixWorld();
  }

  _handleTrackingLoss(deltaSeconds) {
    if (!this.controlledBones.length) {
      return;
    }

    if (performance.now() - this.lastTrackedAt < this.options.lostTrackingHoldMs) {
      return;
    }

    const lerpFactor = computeLerpFactor(this.options.rotationSpeed * 0.5, deltaSeconds);
    if (lerpFactor <= 0) {
      return;
    }

    for (const [name, bone] of Object.entries(this.bones)) {
      const restLocalRotation = this.restLocal[name];
      if (!bone || !restLocalRotation) {
        continue;
      }

      bone.quaternion.slerp(restLocalRotation, lerpFactor);
      bone.updateMatrixWorld();
    }
  }

  _slerpBoneWorld(bone, targetWorldRotation, lerpFactor) {
    if (!bone || !targetWorldRotation || lerpFactor <= 0) {
      return;
    }

    const parentWorldRotation = bone.parent
      ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
      : IDENTITY_QUATERNION.clone();

    const targetLocalRotation = parentWorldRotation.invert().multiply(targetWorldRotation.clone()).normalize();
    bone.quaternion.slerp(targetLocalRotation, clamp01(lerpFactor));
    bone.updateMatrixWorld();
  }
}